import { Inject, Injectable, Logger } from '@nestjs/common';
import { MESSAGE_INTERPRETER } from '../../domain/ai/message-interpreter.port';
import type { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { RESPONSE_GENERATOR } from '../../domain/ai/response-generator.port';
import type { ResponseGenerator } from '../../domain/ai/response-generator.port';
import { PendingQuery } from '../../domain/users/pending-query';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { SearchResponse } from '../../domain/search/search-response';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { RegisterSavingUseCase } from '../savings/register-saving.use-case';
import { BrowseByCategoryUseCase } from '../search/browse-by-category.use-case';
import { buildRecommendationFromSearch } from '../search/build-recommendation-from-search';
import { SearchUseCase } from '../search/search.use-case';
import { ResolveUserUseCase } from '../users/resolve-user.use-case';
import { SetUserBanksUseCase } from '../users/set-user-banks.use-case';
import { SavePendingQueryUseCase } from '../users/save-pending-query.use-case';
import { ClearPendingQueryUseCase } from '../users/clear-pending-query.use-case';

const CANT_UNDERSTAND_MESSAGE =
  'No entendí bien qué buscás. Contame el nombre del comercio (ej. "Ta-Ta Pocitos") ' +
  'o qué tipo de lugar (ej. "necesito una farmacia").';
const NOT_FOUND_MESSAGE =
  'No encontré ese comercio. ¿Podés escribir el nombre de nuevo?';
const ASK_BANKS_MESSAGE =
  '¿Qué tarjetas tenés? Contame (ej. "tengo Itaú y Santander") o escribí ' +
  '"dame todas" para ver todas las ofertas sin filtrar.';

/**
 * Orquesta un mensaje entrante en 3 capas: Intent Parser (IA, interpreta
 * qué preguntó), Recommendation Engine (backend puro, resuelve la
 * comparación hoy-vs-7-días y arma una Recommendation), Response Generator
 * (IA, la redacta como una recomendación — nunca decide promociones, eso ya
 * viene resuelto).
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
    private readonly sender: WhatsAppSenderService,
  ) {}

  async execute(from: string, text: string): Promise<void> {
    const intent = await this.interpreter.interpret(text);

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

    // Un mensaje "puro" de respuesta (sin comercio/categoría propios) que
    // trae bancos o pide "todas" contesta la pregunta pendiente, si había.
    const isAnswerToPending =
      !intent.merchantName &&
      !intent.categoryName &&
      (intent.showAllBanks || (intent.banks?.length ?? 0) > 0);

    const effectiveQuery: PendingQuery =
      isAnswerToPending && user?.pendingQuery ? user.pendingQuery : intent;

    const wantsAction = Boolean(
      effectiveQuery.merchantName ||
        effectiveQuery.categoryName ||
        effectiveQuery.wantsGeneralSavings,
    );
    const needsBankQuestion =
      wantsAction && !hasKnownBanks && !intent.showAllBanks;

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
      await this.sender.sendTextMessage(from, ASK_BANKS_MESSAGE);
      return;
    }

    if (user?.pendingQuery) {
      await this.clearPendingQuery.execute(from);
    }

    // showAllBanks pide explícitamente ignorar el filtro para ESTE mensaje
    // (ej. "dame todas las ofertas") — no borra ni toca los bancos guardados,
    // solo no los usamos como filtro en esta consulta puntual.
    const filterUserId = intent.showAllBanks ? undefined : user?.id;

    const reply = await this.buildReply(from, effectiveQuery, filterUserId);
    const finalReply = bankConfirmation
      ? `${bankConfirmation}\n\n${reply}`
      : reply;

    await this.sender.sendTextMessage(from, finalReply);
  }

  private async buildReply(
    from: string,
    query: PendingQuery,
    filterUserId: string | undefined,
  ): Promise<string> {
    if (query.merchantName) {
      const q = [query.merchantName, query.branchHint].filter(Boolean).join(' ');
      const result = await this.searchUseCase.execute({
        q,
        userId: filterUserId,
        amount: query.amount ?? undefined,
      });
      return this.formatSearchResponse(from, result, query.amount, query.zone);
    }

    if (query.categoryName) {
      const recommendation = await this.browseByCategory.execute(
        query.categoryName,
        query.zone,
        filterUserId,
      );
      return this.respondToRecommendation(recommendation);
    }

    if (query.wantsGeneralSavings) {
      // Sin comercio ni categoría puntual ("quiero ahorrar hoy") -> mirá
      // las 3 categorías del MVP juntas y traé la mejor oferta de todas.
      const recommendation = await this.browseByCategory.execute(
        null,
        query.zone,
        filterUserId,
      );
      return this.respondToRecommendation(recommendation);
    }

    return CANT_UNDERSTAND_MESSAGE;
  }

  /** Response Generator solo entra en juego cuando hay algo real que recomendar — nada que redactar si no hay data. */
  private async respondToRecommendation(
    recommendation: Recommendation,
  ): Promise<string> {
    if (recommendation.nothingFound) {
      return `No encontré promociones vigentes para ${recommendation.queryLabel} en los próximos 7 días.`;
    }
    return this.responseGenerator.generate(recommendation);
  }

  private async formatSearchResponse(
    from: string,
    result: SearchResponse,
    amount: number | null,
    zone: string | null,
  ): Promise<string> {
    if (result.status === 'not_found') return NOT_FOUND_MESSAGE;

    if (result.status === 'disambiguate') {
      const options = result.options
        .map(
          (o) =>
            `- ${o.branchName}${o.neighborhood ? ` (${o.neighborhood})` : ''}`,
        )
        .join('\n');
      return `¿En cuál ${result.merchantChainName}?\n${options}`;
    }

    const recommendation = buildRecommendationFromSearch(result, zone);
    let message = await this.respondToRecommendation(recommendation);

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

    return message;
  }
}
