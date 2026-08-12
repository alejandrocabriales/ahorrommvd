import { Recommendation } from '../recommendation/recommendation';

export interface ResponseGenerator {
  /** Redacta en lenguaje natural — nunca decide qué promoción mostrar, eso ya viene resuelto en `recommendation`. */
  generate(recommendation: Recommendation): Promise<string>;
}

export const RESPONSE_GENERATOR = Symbol('RESPONSE_GENERATOR');
