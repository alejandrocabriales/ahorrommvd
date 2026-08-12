import { PendingQuery } from './pending-query';
import { Recommendation } from '../recommendation/recommendation';

/**
 * Lo último que resolvimos para este usuario — no una pregunta pendiente
 * (eso es PendingQuery), sino de qué veníamos hablando, para que "600
 * pesos" o "y en Pocitos?" no arranquen de cero. Vive ~30 minutos: pasado
 * ese tiempo asumimos que es una conversación nueva, no un seguimiento.
 */
export interface ConversationContext {
  query: PendingQuery;
  recommendation: Recommendation;
  /** ISO timestamp — ver isContextFresh para el chequeo de TTL. */
  updatedAt: string;
}

export const CONVERSATION_CONTEXT_TTL_MINUTES = 30;

export function isContextFresh(
  context: ConversationContext,
  now: Date,
): boolean {
  const ageMs = now.getTime() - new Date(context.updatedAt).getTime();
  return ageMs >= 0 && ageMs <= CONVERSATION_CONTEXT_TTL_MINUTES * 60_000;
}
