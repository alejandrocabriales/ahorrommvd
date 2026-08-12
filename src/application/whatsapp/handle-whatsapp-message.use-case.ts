import { Inject, Injectable, Logger } from '@nestjs/common';
import { MESSAGE_INTERPRETER } from '../../domain/ai/message-interpreter.port';
import type { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { RESPONSE_GENERATOR } from '../../domain/ai/response-generator.port';
import type { ResponseGenerator } from '../../domain/ai/response-generator.port';
import { PendingQuery } from '../../domain/users/pending-query';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { SearchResponse } from '../../domain/search/search-response';
import { isContextFresh } from '../../domain/users/conversation-context';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { RegisterSavingUseCase } from '../savings/register-saving.use-case';
import { BrowseByCategoryUseCase } from '../search/browse-by-category.use-case';
import { buildRecommendationFromSearch } from '../search/build-recommendation-from-search';
import { SearchUseCase } from '../search/search.use-case';
import { ResolveUserUseCase } from '../users/resolve-user.use-case';
import { SetUserBanksUseCase } from '../users/set-user-banks.use-case';
import { SavePendingQueryUseCase } from '../users/save-pending-query.use-case';
import { ClearPendingQueryUseCase } from '../users/clear-pending-query.use-case';
import { SaveConversationContextUseCase } from '../users/save-conversation-context.use-case';
import { mergeWithContext } from '../users/merge-with-context';
import { buildContextualShortReply } from '../users/build-contextual-short-reply';

const CANT_UNDERSTAND_MESSAGE =
  'No entendí bien qué buscás. Contame el nombre del comercio (ej. "Ta-Ta Pocitos") ' +
  'o qué tipo de lugar (ej. "necesito una farmacia").';
const NOT_FOUND_MESSAGE =
  'No encontré ese comercio. ¿Podés escribir el nombre de nuevo?';
const ASK_BANKS_MESSAGE =
  '¿Qué tarjetas tenés? Contame (ej. "tengo Itaú y Santander") o escribí ' +
  '"dame todas" para ver todas las ofertas sin filtrar.';

interface ReplyResult {
  message: string;
  /** null cuando no hubo una Recommendation real que valga la pena recordar (no encontrado, desambiguar, no entendí). */
  recommendation: Recommendation | null;
}

/**
 * Orquesta un mensaje entrante en 3 capas: Intent Parser (IA, interpreta
 * qué preguntó), Recommendation Engine (backend puro, resuelve la
 * comparación hoy-vs-7-días y arma una Recommendation), Response Generator
 * (IA, la redacta como una recomendación — nunca decide promociones, eso ya
 * viene resuelto).
 *
 * Memoria de corto plazo (~30 min, ver ConversationContext): si el mensaje
 * no trae comercio/categoría propios, primero probamos si es una
 * confirmación/espera corta ("me sirve", "mañana entonces" —
 * buildContextualShortReply) y si no, completamos los campos que falten
 * con lo último que hablamos (mergeWithContext) antes de decidir qué
 * responder. Así "600 pesos" o "y en Pocitos?" no vuelven a arrancar de
 * cero. El barrio conocido del usuario (knownZone) se usa como default
 * cuando ni el mensaje ni el contexto reciente traen uno.
 *
 * Si todavía no sabemos qué tarjetas tiene, preguntamos ANTES de contestar
 * (no después con un tip) y guardamos la consulta como pendiente para
 * retomarla en cuanto conteste — "tengo Itaú" filtra, "dame todas" no filtra.
 */
@Injectable()
export class HandleWhatsAppMessageUseCase {
  private readonly logger = new Logger(HandleWhatsAppMessageUseCase.name);

  constructor(
    @Inject(MESSAGE_INTERPRETER)
    private readonly interpreter: MessageInterpreter,
    @Inject(RESPONSE_GENERATOR)
    private readonly responseGenerator: ResponseGenerator,
    private readonly searchUseCase: SearchUseCase,
    private readonly browseByCategory: BrowseByCategoryUseCase,
    private readonly registerSaving: RegisterSavingUseCase,
    private readonly resolveUser: ResolveUserUseCase,
    private readonly setUserBanks: SetUserBanksUseCase,
    private readonly savePendingQuery: SavePendingQueryUseCase,
    private readonly clearPendingQuery: ClearPendingQueryUseCase,
    private readonly saveConversationContext: SaveConversationContextUseCase,
    private readonly sender: WhatsAppSenderService,
  ) {}

  async execute(from: string, text: string): Promise<void> {
    const intent = await this.interpreter.interpret(text);
    const now = new Date();

    // Si mencionó bancos en este mismo mensaje, los guardamos ANTES de
    // resolver el usuario — así, si también preguntó por un comercio en el
    // mismo mensaje ("tengo Itaú, Ta-Ta Pocitos"), ya filtra con eso.
    let bankConfirmation: string | null = null;
    if (intent.banks && intent.banks.length > 0) {
      const result = await this.setUserBanks.execute(from, intent.banks);
      bankConfirmation =
        result.bankNames.length > 0
          ? `Listo, guardé que tenés tarjetas de ${result.bankNames.join(', ')}.`
          : null;
    }

    const user = await this.resolveUser.execute(from);
    const hasKnownBanks = (user?.bankNames.length ?? 0) > 0;
    const context = user?.conversationContext ?? null;

    // "me sirve", "voy ahora", "mañana entonces" no piden un dato nuevo,
    // reaccionan a lo último que recomendamos — no pasa por el Recommendation
    // Engine de nuevo, solo si no hay una pregunta de bancos pendiente (esa
    // manda primero) y el contexto sigue fresco.
    let shortReply: string | null = null;
    if (!user?.pendingQuery && context && isContextFresh(context, now)) {
      shortReply = buildContextualShortReply(intent, context);
    }
    if (shortReply && context) {
      await this.saveConversationContext.execute(from, {
        ...context,
        updatedAt: now.toISOString(),
      });
      await this.sender.sendTextMessage(
        from,
        this.withBankConfirmation(bankConfirmation, shortReply),
      );
      return;
    }

    // Un mensaje "puro" de respuesta (sin comercio/categoría propios) que
    // trae bancos o pide "todas" contesta la pregunta pendiente, si había.
    const isAnswerToPending =
      !intent.merchantName &&
      !intent.categoryName &&
      (intent.showAllBanks || (intent.banks?.length ?? 0) > 0);

    const rawEffectiveQuery: PendingQuery =
      isAnswerToPending && user?.pendingQuery
        ? user.pendingQuery
        : mergeWithContext(intent, context, now);

    // Un barrio SOLO (sin comercio/categoría propios, ej. "Pocitos" a secas)
    // ya es un pedido en sí — mirá las 3 categorías del MVP en esa zona en
    // vez de contestar "no entendí". Tiene que salir de rawEffectiveQuery
    // (lo que el usuario/contexto realmente trajo), nunca del default de
    // knownZone de abajo — si no, un "hola" con barrio conocido dispararía
    // una recomendación que nadie pidió.
    const hasTopic = Boolean(
      rawEffectiveQuery.merchantName ||
        rawEffectiveQuery.categoryName ||
        rawEffectiveQuery.wantsGeneralSavings ||
        rawEffectiveQuery.zone,
    );

    // Ubicación contextual: si ya hay un tema real y ni el mensaje ni la
    // memoria de 30 min traen un barrio, usamos el conocido del usuario de
    // default — no cambia el resultado (no hay filtro por cercanía real
    // todavía), así que no vale la pena volver a preguntar. Nunca alcanza
    // por sí solo para inventar un tema donde no lo hay.
    const effectiveQuery: PendingQuery = {
      ...rawEffectiveQuery,
      zone: rawEffectiveQuery.zone ?? (hasTopic ? (user?.knownZone ?? null) : null),
    };

    const needsBankQuestion = hasTopic && !hasKnownBanks && !intent.showAllBanks;

    if (needsBankQuestion) {
      // Recortado explícito a la forma de PendingQuery — effectiveQuery
      // puede ser el ParsedIntent crudo (con banks/showAllBanks de más) y no
      // queremos que eso termine serializado en la columna.
      await this.savePendingQuery.execute(from, {
        merchantName: effectiveQuery.merchantName,
        branchHint: effectiveQuery.branchHint,
        categoryName: effectiveQuery.categoryName,
        zone: effectiveQuery.zone,
        amount: effectiveQuery.amount,
        wantsGeneralSavings: effectiveQuery.wantsGeneralSavings,
      });
      await this.sender.sendTextMessage(
        from,
        this.withBankConfirmation(bankConfirmation, ASK_BANKS_MESSAGE),
      );
      return;
    }

    if (user?.pendingQuery) {
      await this.clearPendingQuery.execute(from);
    }

    // showAllBanks pide explícitamente ignorar el filtro para ESTE mensaje
    // (ej. "dame todas las ofertas") — no borra ni toca los bancos guardados,
    // solo no los usamos como filtro en esta consulta puntual.
    const filterUserId = intent.showAllBanks ? undefined : user?.id;

    const { message, recommendation } = await this.buildReply(
      from,
      effectiveQuery,
      filterUserId,
      intent.asksLocation,
    );

    await this.sender.sendTextMessage(
      from,
      this.withBankConfirmation(bankConfirmation, message),
    );

    // Solo guardamos memoria cuando hubo algo real que recordar — "no
    // encontré", "¿en cuál sucursal?" o "no entendí" no son un tema del que
    // valga la pena hacer seguimiento después.
    if (recommendation) {
      await this.saveConversationContext.execute(from, {
        query: effectiveQuery,
        recommendation,
        updatedAt: now.toISOString(),
      });
    }
  }

  private withBankConfirmation(
    bankConfirmation: string | null,
    message: string,
  ): string {
    return bankConfirmation ? `${bankConfirmation}\n\n${message}` : message;
  }

  private async buildReply(
    from: string,
    query: PendingQuery,
    filterUserId: string | undefined,
    asksLocation: boolean,
  ): Promise<ReplyResult> {
    if (query.merchantName) {
      const q = [query.merchantName, query.branchHint]
        .filter(Boolean)
        .join(' ');
      const result = await this.searchUseCase.execute({
        q,
        userId: filterUserId,
        amount: query.amount ?? undefined,
      });
      return this.formatSearchResponse(
        from,
        result,
        query.amount,
        query.zone,
        asksLocation,
      );
    }

    if (query.categoryName) {
      const recommendation = await this.browseByCategory.execute(
        query.categoryName,
        query.zone,
        filterUserId,
        query.amount ?? undefined,
      );
      return this.respondToRecommendation(recommendation);
    }

    if (query.wantsGeneralSavings || query.zone) {
      // Sin comercio ni categoría puntual ("quiero ahorrar hoy", o un
      // barrio a secas como "Pocitos") -> mirá las 3 categorías del MVP
      // juntas y traé la mejor oferta de todas (con el barrio como dato
      // informativo si lo hay).
      const recommendation = await this.browseByCategory.execute(
        null,
        query.zone,
        filterUserId,
        query.amount ?? undefined,
      );
      return this.respondToRecommendation(recommendation);
    }

    return { message: CANT_UNDERSTAND_MESSAGE, recommendation: null };
  }

  /** Response Generator solo entra en juego cuando hay algo real que recomendar — nada que redactar si no hay data. */
  private async respondToRecommendation(
    recommendation: Recommendation,
  ): Promise<ReplyResult> {
    if (recommendation.nothingFound) {
      return {
        message: `No encontré promociones vigentes para ${recommendation.queryLabel} en los próximos 7 días.`,
        recommendation: null,
      };
    }
    const message = await this.responseGenerator.generate(recommendation);
    return { message, recommendation };
  }

  private async formatSearchResponse(
    from: string,
    result: SearchResponse,
    amount: number | null,
    zone: string | null,
    asksLocation: boolean,
  ): Promise<ReplyResult> {
    if (result.status === 'not_found') {
      return { message: NOT_FOUND_MESSAGE, recommendation: null };
    }

    if (result.status === 'disambiguate') {
      const options = result.options
        .map(
          (o) =>
            `- ${o.branchName}${o.neighborhood ? ` (${o.neighborhood})` : ''}${o.address ? ` — ${o.address}` : ''}`,
        )
        .join('\n');
      return {
        message: `¿En cuál ${result.merchantChainName}?\n${options}`,
        recommendation: null,
      };
    }

    const recommendation = buildRecommendationFromSearch(
      result,
      zone,
      amount ?? null,
      asksLocation,
    );
    const built = await this.respondToRecommendation(recommendation);
    let message = built.message;

    // Registro opcional de gasto (spec): si el usuario ya mandó comercio +
    // monto en el mismo mensaje (ej. "Ta-Ta 4000") y resolvimos una
    // sucursal puntual, registramos directo en vez de preguntar de nuevo.
    // Si falla (ej. sin promo vigente hoy) no rompemos la respuesta
    // principal, solo se pierde la confirmación de registro.
    if (amount && result.branchId) {
      try {
        const saving = await this.registerSaving.execute(
          from,
          result.branchId,
          amount,
        );
        message = `${message}\n\n${saving.message}`;
      } catch (err) {
        this.logger.warn(`No se pudo registrar el gasto: ${err}`);
      }
    }

    return { message, recommendation: built.recommendation };
  }
}
