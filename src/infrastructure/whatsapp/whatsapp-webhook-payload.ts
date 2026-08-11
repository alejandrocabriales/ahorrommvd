/** Forma (recortada a lo que usamos) del payload que manda Meta a POST /whatsapp/webhook. */
export interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}

export interface IncomingWhatsAppMessage {
  from: string;
  text: string;
}

/**
 * El mismo webhook también recibe eventos que no son mensajes de texto de
 * un usuario (confirmaciones de entrega/lectura, mensajes de otro tipo
 * como audio/imagen). Devolvemos null para esos casos y el controller
 * responde 200 igual sin hacer nada — Meta no reintenta si contestás 200.
 */
export function extractTextMessage(
  payload: WhatsAppWebhookPayload,
): IncomingWhatsAppMessage | null {
  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text' || !message.text?.body) return null;
  return { from: message.from, text: message.text.body };
}
