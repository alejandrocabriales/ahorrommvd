import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { ConversationContext } from '../../domain/users/conversation-context';

function dayLabel(daysFromNow: number): string {
  return daysFromNow === 1 ? 'mañana' : `en ${daysFromNow} días`;
}

/**
 * "me sirve", "voy ahora", "mañana entonces" no piden un dato nuevo — son
 * una reacción a lo que ya recomendamos. Redactarlas armando un
 * `Recommendation` de mentira solo para volver a pasar por el Response
 * Generator sería reescribir casi lo mismo que ya dijimos; en vez de eso,
 * un template fijo con los datos reales de `context.recommendation` (igual
 * de determinístico que `CANT_UNDERSTAND_MESSAGE` o `buildSearchMessage`
 * en el resto del código) — no vale la pena el costo/latencia de IA para
 * una confirmación corta.
 *
 * Devuelve null cuando no hay suficiente data para confirmar/esperar con
 * confianza (ej. pidió esperar pero no habíamos visto una mejora futura)
 * — en ese caso el flujo normal (merge + Recommendation Engine) sigue
 * andando en vez de inventar algo acá.
 */
export function buildContextualShortReply(
  intent: ParsedIntent,
  context: ConversationContext,
): string | null {
  const { recommendation } = context;

  if (intent.prefersToWait) {
    if (!recommendation.betterSoon) return null;
    const { option, daysFromNow, estimatedSaving } = recommendation.betterSoon;
    const place = option.branchName ?? option.merchantChainName;
    const todayPart = recommendation.bestToday
      ? ` (contra el ${recommendation.bestToday.discountPercentage}% de hoy)`
      : '';
    // Si ya sabemos cuánto piensa gastar, comparamos $ directo en vez de
    // solo ofrecer calcularlo — mismo dato, una decisión más fácil de leer.
    const savingPart = estimatedSaving
      ? ` — unos $${estimatedSaving.amount} de ahorro${estimatedSaving.cappedByBank ? ' (tope de la promo)' : ''}`
      : '';
    const closing = estimatedSaving
      ? ''
      : ' Avisame cuando quieras que te calcule el ahorro con un monto.';
    return (
      `Dale, esperar conviene: ${dayLabel(daysFromNow)} ${place} tiene ` +
      `${option.discountPercentage}% con ${option.bankName}${savingPart}${todayPart}.${closing}`
    );
  }

  if (intent.confirmsRecommendation) {
    if (!recommendation.bestToday) return null;
    const { bestToday } = recommendation;
    const place = bestToday.branchName ?? bestToday.merchantChainName;
    const savingPart = recommendation.estimatedSavingToday
      ? ` (unos $${recommendation.estimatedSavingToday.amount} de ahorro${recommendation.estimatedSavingToday.cappedByBank ? ', tope de la promo' : ''})`
      : '';
    return `Perfecto. Andá con ${bestToday.bankName} en ${place} — ${bestToday.discountPercentage}%${savingPart}.`;
  }

  return null;
}
