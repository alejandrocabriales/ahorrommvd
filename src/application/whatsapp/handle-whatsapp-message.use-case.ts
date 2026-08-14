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
import { SetUserCityUseCase } from '../users/set-user-city.use-case';
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
const ASK_ZONE_MESSAGE =
  '¿Por qué zona de Montevideo andás? Así te tiro algo cerca tuyo, no ' +
  'una promo del otro lado de la ciudad.';
const UNSUPPORTED_CATEGORY_MESSAGE =
  'Por ahora solo tengo cargados descuentos de Supermercados, Farmacias y ' +
  'Restaurantes. Para pedir otra categoría, entrá acá y escribinos a ' +
  'soporte: https://ahorromvd-landing.netlify.app/';

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
    private readonly setUserCity: SetUserCityUseCase,
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

    // Igual que bancos: se guarda apenas se detecta, no depende de que este
    // mensaje tenga un tema que responder ("vivo en Maldonado" solo, sin
    // pedir nada más, igual queda guardado).
    let cityConfirmation: string | null = null;
    if (intent.city) {
      const result = await this.setUserCity.execute(from, intent.city);
      cityConfirmation = result
        ? `Listo, guardé que estás en ${result.city}.`
        : null;
    }

    const confirmation =
      [bankConfirmation, cityConfirmation].filter(Boolean).join('\n\n') ||
      null;

    const user = await this.resolveUser.execute(from);
    const hasKnownBanks = (user?.bankNames.length ?? 0) > 0;
    const context = user?.conversationContext ?? null;

    // Pidió un tipo de comercio que no es ninguna de las 3 categorías del
    // MVP (ej. "verdulerías") — cortamos acá, ANTES de mergear con contexto
    // o preguntar bancos: si no, wantsGeneralSavings/browseByCategory(null)
    // termina mezclando las 3 categorías reales como si el usuario las
    // hubiese pedido (bug encontrado en vivo). No hay Recommendation que
    // guardar, así que tampoco tocamos conversationContext.
    if (intent.unsupportedCategory) {
      if (user?.pendingQuery) {
        await this.clearPendingQuery.execute(from);
      }
      await this.sender.sendTextMessage(
        from,
        this.withConfirmations(confirmation, UNSUPPORTED_CATEGORY_MESSAGE),
      );
      return;
    }

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
        this.withConfirmations(confirmation, shortReply),
      );
      return;
    }

    // Un mensaje "puro" de respuesta (sin comercio/categoría propios) que
    // trae bancos, pide "todas", o solo un barrio (respuesta a
    // ASK_ZONE_MESSAGE, ej. "Pocitos") contesta la pregunta pendiente, si
    // había.
    const isAnswerToPending =
      !intent.merchantName &&
      !intent.categoryName &&
      (intent.showAllBanks ||
        (intent.banks?.length ?? 0) > 0 ||
        Boolean(intent.zone));

    // Al restaurar el pending, el barrio de ESTE mensaje pisa el que tenía
    // guardado (que es null — por eso se había preguntado) — si no, la
    // respuesta a ASK_ZONE_MESSAGE se perdería y quedaría preguntando de
    // nuevo en un loop.
    const rawEffectiveQuery: PendingQuery =
      isAnswerToPending && user?.pendingQuery
        ? { ...user.pendingQuery, zone: intent.zone ?? user.pendingQuery.zone }
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
    // default (BrowseByCategoryUseCase sí filtra por distancia real desde
    // acá — ver ZoneGeocoder). Nunca alcanza por sí solo para inventar un
    // tema donde no lo hay.
    const effectiveQuery: PendingQuery = {
      ...rawEffectiveQuery,
      zone: rawEffectiveQuery.zone ?? (hasTopic ? (user?.knownZone ?? null) : null),
    };

    // El usuario dijo alguna vez que está en otra ciudad (knownCity) y pide
    // una categoría/lo mejor en general — ahí no hay nada real que
    // recomendar todavía (el catálogo entero es de Montevideo), así que
    // avisamos en vez de aplicar datos de Montevideo como si sirvieran ahí.
    // Antes de banks/zone a propósito: no tiene sentido juntar más info
    // para una consulta que de entrada no podemos responder. Un comercio
    // puntual (merchantName) sigue andando igual — quizás preguntan por
    // algo que sí conocemos, sea cual sea la ciudad.
    const needsCityDecline =
      Boolean(user?.knownCity) &&
      !rawEffectiveQuery.merchantName &&
      (Boolean(rawEffectiveQuery.categoryName) ||
        rawEffectiveQuery.wantsGeneralSavings);

    if (needsCityDecline) {
      if (user?.pendingQuery) {
        await this.clearPendingQuery.execute(from);
      }
      await this.sender.sendTextMessage(
        from,
        this.withConfirmations(
          confirmation,
          `Por ahora solo tengo datos reales de Montevideo — en ${user!.knownCity} ` +
            'todavía no puedo confirmarte nada. Si me decís el nombre de un ' +
            'comercio puntual lo busco igual.',
        ),
      );
      return;
    }

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
        this.withConfirmations(confirmation, ASK_BANKS_MESSAGE),
      );
      return;
    }

    // Pidió una categoría puntual ("necesito una farmacia") y no sabemos ni
    // el barrio del mensaje ni el knownZone guardado — sin eso
    // BrowseByCategoryUseCase no tiene con qué filtrar por distancia real.
    // Acotado a categoryName puntual (no a wantsGeneralSavings/zone-solo):
    // "quiero ahorrar hoy" es a propósito una consulta amplia de toda
    // Montevideo, no vale la pena la fricción de preguntar ahí.
    const needsZoneQuestion =
      Boolean(effectiveQuery.categoryName) &&
      !effectiveQuery.merchantName &&
      !effectiveQuery.zone;

    if (needsZoneQuestion) {
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
        this.withConfirmations(confirmation, ASK_ZONE_MESSAGE),
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
      this.withConfirmations(confirmation, message),
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

  private withConfirmations(
    confirmation: string | null,
    message: string,
  ): string {
    return confirmation ? `${confirmation}\n\n${message}` : message;
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
      return this.respondToRecommendation(
        recommendation,
        query.categoryName,
        Boolean(filterUserId),
      );
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
      return this.respondToRecommendation(
        recommendation,
        null,
        Boolean(filterUserId),
      );
    }

    return { message: CANT_UNDERSTAND_MESSAGE, recommendation: null };
  }

  /** Response Generator solo entra en juego cuando hay algo real que recomendar — nada que redactar si no hay data. */
  private async respondToRecommendation(
    recommendation: Recommendation,
    categoryName: string | null,
    filteredByCards: boolean,
  ): Promise<ReplyResult> {
    // Sí hay promos vigentes, pero ninguna en un comercio que podamos
    // confirmar en Montevideo — lo decimos tal cual en vez de ofrecerlas
    // igual con un "fijate antes de ir" (bug real: Soho/Punta del Este y
    // Chajá ofrecidos a un usuario Itaú+OCA que preguntó dónde comer). No
    // pasa por el Response Generator a propósito: con una IA redactando
    // esto, "no tengo nada" tiende a convertirse en una recomendación tibia.
    if (recommendation.nothingFound && recommendation.unverifiedOnly) {
      // "con tus tarjetas" solo si de verdad filtramos por sus bancos —
      // con showAllBanks la búsqueda fue abierta y decirlo sería falso.
      const what = categoryName ? `ningún local de ${categoryName}` : 'nada';
      const cards = filteredByCards ? ' con tus tarjetas' : '';
      return {
        message:
          `Hoy no tengo ${what} confirmado en Montevideo${cards}. Hay promos ` +
          'vigentes, pero no puedo confirmar que esos comercios tengan local ' +
          'acá, así que no te las recomiendo. ¿Querés que mire otra categoría?',
        recommendation: null,
      };
    }
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

    // "¿dónde queda X?" cuando no tenemos NINGUNA sucursal de X cargada
    // (resuelto a nivel cadena, sin branchId): no hay dirección que dar y
    // tampoco sabemos que la cadena tenga un local acá. Va sin IA a
    // propósito — redactando, "no tengo la dirección" se le convierte en
    // "aplica en cualquier local, buscá el más cercano", que es afirmar que
    // esos locales existen (bug real: "donde queda Soho?" contestado así,
    // cuando el bar está en Punta del Este).
    if (asksLocation && !result.branchId) {
      return {
        message:
          `No tengo ninguna sucursal de ${result.merchantChainName} cargada, así que ` +
          'no te puedo decir dónde queda ni confirmarte que tenga local en ' +
          'Montevideo. ¿Querés que busque otra opción?',
        recommendation: null,
      };
    }

    const recommendation = buildRecommendationFromSearch(
      result,
      zone,
      amount ?? null,
      asksLocation,
    );
    // Comercio puntual: `unverifiedOnly` siempre viene en false (el usuario
    // eligió el comercio), así que la rama de "nada confirmado" no aplica acá.
    const built = await this.respondToRecommendation(
      recommendation,
      null,
      false,
    );
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
