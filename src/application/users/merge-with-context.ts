import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { PendingQuery } from '../../domain/users/pending-query';
import {
  ConversationContext,
  isContextFresh,
} from '../../domain/users/conversation-context';

function bare(intent: ParsedIntent): PendingQuery {
  return {
    merchantName: intent.merchantName,
    branchHint: intent.branchHint,
    categoryName: intent.categoryName,
    zone: intent.zone,
    amount: intent.amount,
    wantsGeneralSavings: intent.wantsGeneralSavings,
  };
}

/**
 * "600 pesos", "y en Pocitos?", "me sirve" no traen comercio ni categoría
 * propios — sin esto, el bot los trata como un mensaje nuevo y no
 * encuentra nada que responder ("no entendí bien qué buscás"). Si el
 * contexto de los últimos 30 minutos tiene una consulta resuelta y el
 * mensaje no abre un tema propio, completamos lo que falta con lo último
 * que hablamos.
 *
 * Puro y determinístico a propósito — mismo criterio que el resto del
 * Recommendation Engine: la IA interpreta el mensaje suelto, esto decide
 * cómo se combina con la memoria, sin una llamada más a OpenRouter.
 */
export function mergeWithContext(
  intent: ParsedIntent,
  context: ConversationContext | null,
  now: Date,
): PendingQuery {
  if (!context || !isContextFresh(context, now)) return bare(intent);

  // Ya trae su propio comercio/categoría/pedido general -> es un tema
  // nuevo, no un seguimiento. No lo pisamos con el contexto anterior.
  const opensNewTopic =
    intent.merchantName || intent.categoryName || intent.wantsGeneralSavings;
  if (opensNewTopic) return bare(intent);

  // Nada que ligue este mensaje al contexto (ni monto, ni zona, ni una
  // confirmación/espera, ni un cambio de tarjetas) -> tratalo como mensaje
  // suelto ("hola"), no fuerces un seguimiento que no pidieron.
  //
  // Las tarjetas cuentan como seguimiento: "y para tarjetas Itaú?" es la
  // misma pregunta de recién con otro filtro. Sin esto quedaba sin tema y
  // se contestaba "no entendí bien qué buscás" (bug real, conversación del
  // 14/8) justo después de guardarle el banco.
  const hasFollowUpSignal =
    intent.zone !== null ||
    intent.amount !== null ||
    intent.confirmsRecommendation ||
    intent.prefersToWait ||
    (intent.banks?.length ?? 0) > 0 ||
    intent.showAllBanks;
  if (!hasFollowUpSignal) return bare(intent);

  const { query } = context;
  // Un barrio nuevo después de un comercio puntual se lee como sucursal
  // ("Ta-Ta" + "Pocitos" -> "Ta-Ta Pocitos"), no como zona informativa de
  // categoría — así "y en Pocitos?" reconsulta esa sucursal en concreto.
  const refinesBranch = Boolean(intent.zone && query.merchantName);

  return {
    merchantName: query.merchantName,
    branchHint: refinesBranch ? intent.zone : query.branchHint,
    categoryName: query.categoryName,
    zone: refinesBranch ? query.zone : (intent.zone ?? query.zone),
    amount: intent.amount ?? query.amount,
    wantsGeneralSavings: query.wantsGeneralSavings,
  };
}
