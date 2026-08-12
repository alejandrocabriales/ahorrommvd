import { Inject, Injectable, Logger } from '@nestjs/common';
import { MESSAGE_INTERPRETER } from '../../domain/ai/message-interpreter.port';
import type { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { SearchResponse } from '../../domain/search/search-response';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { RegisterSavingUseCase } from '../savings/register-saving.use-case';
import { BrowseByCategoryUseCase } from '../search/browse-by-category.use-case';
import { buildCategoryBrowseMessage } from '../search/search-message';
import { SearchUseCase } from '../search/search.use-case';
import { ResolveUserUseCase } from '../users/resolve-user.use-case';
import { SetUserBanksUseCase } from '../users/set-user-banks.use-case';

const CANT_UNDERSTAND_MESSAGE =
  'No entendí bien qué buscás. Contame el nombre del comercio (ej. "Ta-Ta Pocitos") ' +
  'o qué tipo de lugar (ej. "necesito una farmacia").';
const NOT_FOUND_MESSAGE =
  'No encontré ese comercio. ¿Podés escribir el nombre de nuevo?';
const KNOW_YOUR_BANKS_TIP =
  'Tip: contame qué tarjetas tenés (ej. "tengo Itaú y Santander") y te muestro ' +
  'solo lo que podés usar de verdad.';

/**
 * Orquesta un mensaje entrante: interpreta con IA (Semana 4) y resuelve con
 * el motor de búsqueda (Semana 3) — la IA nunca decide una promoción, solo
 * extrae qué preguntó el usuario para que el motor consulte la base.
 */
@Injectable()
export class HandleWhatsAppMessageUseCase {
  private readonly logger = new Logger(HandleWhatsAppMessageUseCase.name);

  constructor(
    @Inject(MESSAGE_INTERPRETER)
    private readonly interpreter: MessageInterpreter,
    private readonly searchUseCase: SearchUseCase,
    private readonly browseByCategory: BrowseByCategoryUseCase,
    private readonly registerSaving: RegisterSavingUseCase,
    private readonly resolveUser: ResolveUserUseCase,
    private readonly setUserBanks: SetUserBanksUseCase,
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

    // showAllBanks pide explícitamente ignorar el filtro para ESTE mensaje
    // (ej. "dame todas las ofertas") — no borra ni toca los bancos guardados,
    // solo no los usamos como filtro en esta consulta puntual.
    const filterUserId = intent.showAllBanks ? undefined : user?.id;
    const skipTip = hasKnownBanks || intent.showAllBanks;

    const reply = await this.buildReply(from, intent, filterUserId, skipTip);
    const finalReply = bankConfirmation
      ? `${bankConfirmation}\n\n${reply}`
      : reply;

    await this.sender.sendTextMessage(from, finalReply);
  }

  private async buildReply(
    from: string,
    intent: ParsedIntent,
    filterUserId: string | undefined,
    skipTip: boolean,
  ): Promise<string> {
    if (intent.merchantName) {
      const q = [intent.merchantName, intent.branchHint]
        .filter(Boolean)
        .join(' ');
      const result = await this.searchUseCase.execute({
        q,
        userId: filterUserId,
        amount: intent.amount ?? undefined,
      });
      return this.formatSearchResponse(from, result, intent.amount, skipTip);
    }

    if (intent.categoryName) {
      const options = await this.browseByCategory.execute(
        intent.categoryName,
        filterUserId,
      );
      const message = buildCategoryBrowseMessage(intent.categoryName, options);
      return skipTip ? message : `${message}\n\n${KNOW_YOUR_BANKS_TIP}`;
    }

    return CANT_UNDERSTAND_MESSAGE;
  }

  private async formatSearchResponse(
    from: string,
    result: SearchResponse,
    amount: number | null,
    skipTip: boolean,
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

    let message = result.message;

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

    return skipTip ? message : `${message}\n\n${KNOW_YOUR_BANKS_TIP}`;
  }
}
