import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GRAPH_API_VERSION = 'v21.0';

@Injectable()
export class WhatsAppSenderService {
  private readonly logger = new Logger(WhatsAppSenderService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendTextMessage(to: string, body: string): Promise<void> {
    const token = this.configService.getOrThrow<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.configService.getOrThrow<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
    );

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Envío a WhatsApp falló (${response.status}): ${errorBody}`,
      );
      return;
    }
    this.logger.log(`Envío a WhatsApp OK (${response.status}) para ${to}`);
  }
}
