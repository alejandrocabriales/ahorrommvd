import { MvpCategoryName } from '../scraping/mvp-category';

/**
 * Intención estructurada que devuelve la IA a partir de un mensaje de
 * WhatsApp en lenguaje natural. Estrictamente extracción — la IA nunca
 * inventa comercios ni promociones, solo identifica qué dijo el usuario
 * para que el backend consulte PostgreSQL (spec: "La IA NO debe inventar
 * promociones").
 */
export interface ParsedIntent {
  /** Nombre de comercio/cadena mencionado tal cual lo escribió el usuario (puede tener errores de tipeo). */
  merchantName: string | null;
  /** Sucursal o barrio mencionado junto al comercio, ej. "Pocitos" en "Ta-Ta Pocitos". */
  branchHint: string | null;
  /** Categoría general cuando el usuario no nombra un comercio puntual, ej. "Voy al súper". */
  categoryName: MvpCategoryName | null;
  /** Zona/barrio mencionado sin comercio específico, ej. "Voy a Punta Carretas". */
  zone: string | null;
  /** Monto en pesos uruguayos si el usuario menciona cuánto gastó, ej. "Ta-Ta 4000". */
  amount: number | null;
}
