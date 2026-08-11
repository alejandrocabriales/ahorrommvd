import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandleWhatsAppMessageUseCase } from '../../../application/whatsapp/handle-whatsapp-message.use-case';
import { extractTextMessage } from '../../../infrastructure/whatsapp/whatsapp-webhook-payload';
import type { WhatsAppWebhookPayload } from '../../../infrastructure/whatsapp/whatsapp-webhook-payload';

@Controller('whatsapp/webhook')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly handleMessage: HandleWhatsAppMessageUseCase,
  ) {}

  /** Handshake de verificación que dispara Meta al guardar la config del webhook. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expectedToken = this.configService.getOrThrow<string>(
      'WHATSAPP_VERIFY_TOKEN',
    );
    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return challenge;
    }
    throw new ForbiddenException('Verify token inválido');
  }

  /**
   * Meta espera un 200 rápido y reintenta si no lo recibe — devolvemos 200
   * también cuando el procesamiento falla (no queremos que reintente y
   * mande el mismo mensaje varias veces), solo lo logueamos.
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Body() payload: WhatsAppWebhookPayload,
  ): Promise<{ status: string }> {
    const message = extractTextMessage(payload);
    if (!message) return { status: 'ignored' };

    try {
      await this.handleMessage.execute(message.from, message.text);
    } catch (err) {
      this.logger.error(`Error procesando mensaje de WhatsApp: ${err}`);
    }

    return { status: 'received' };
  }
}
