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

const CANT_UNDERSTAND_MESSAGE =
  'No entendí bien qué buscás. Contame el nombre del comercio (ej. "Ta-Ta Pocitos") ' +
  'o qué tipo de lugar (ej. "necesito una farmacia").';
const NOT_FOUND_MESSAGE =
  'No encontré ese comercio. ¿Podés escribir el nombre de nuevo?';

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
    private readonly sender: WhatsAppSenderService,
  ) {}

  async execute(from: string, text: string): Promise<void> {
    const intent = await this.interpreter.interpret(text);
    const reply = await this.buildReply(from, intent);
    await this.sender.sendTextMessage(from, reply);
  }

  private async buildReply(
    from: string,
    intent: ParsedIntent,
  ): Promise<string> {
    if (intent.merchantName) {
      const q = [intent.merchantName, intent.branchHint]
        .filter(Boolean)
        .join(' ');
      const result = await this.searchUseCase.execute({
        q,
        amount: intent.amount ?? undefined,
      });
      return this.formatSearchResponse(from, result, intent.amount);
    }

    if (intent.categoryName) {
      const options = await this.browseByCategory.execute(intent.categoryName);
      return buildCategoryBrowseMessage(intent.categoryName, options);
    }

    return CANT_UNDERSTAND_MESSAGE;
  }

  private async formatSearchResponse(
    from: string,
    result: SearchResponse,
    amount: number | null,
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
        return `${result.message}\n\n${saving.message}`;
      } catch (err) {
        this.logger.warn(`No se pudo registrar el gasto: ${err}`);
      }
    }

    return result.message;
  }
}
