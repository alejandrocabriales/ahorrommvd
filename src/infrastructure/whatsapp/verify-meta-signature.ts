import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Meta firma cada POST de webhook con HMAC-SHA256 del body crudo, usando el
 * App Secret como clave, y lo manda en el header `X-Hub-Signature-256` con
 * formato `sha256=<hex>`. Sin esto, cualquiera que sepa la URL puede
 * mandarnos un payload falso y disparar una llamada real (y paga) a
 * OpenRouter + un intento real de envío por WhatsApp.
 *
 * Comparación con timingSafeEqual (no `===`) para no filtrar por timing
 * cuánto de la firma coincide.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;

  const [algo, receivedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHex) return false;

  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const received = Buffer.from(receivedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}
