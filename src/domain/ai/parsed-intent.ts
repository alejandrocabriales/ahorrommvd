import { MvpBankName } from '../scraping/bank-name';
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
  /**
   * Ciudad/departamento de Uruguay DISTINTO a Montevideo que el usuario dice
   * que es su ubicación (ej. "vivo en Maldonado" -> "Maldonado"). Distinto
   * de `zone`, que es un barrio DENTRO de Montevideo — un barrio nunca va
   * acá. null si no lo dice explícitamente, o si nombra Montevideo mismo
   * (spec: el bot asume Montevideo por default).
   */
  city: string | null;
  /** Monto en pesos uruguayos si el usuario menciona cuánto gastó, ej. "Ta-Ta 4000". */
  amount: number | null;
  /** Bancos con los que el usuario dice tener tarjeta, ej. "tengo Itaú y Santander". null si no lo menciona en este mensaje. */
  banks: MvpBankName[] | null;
  /** true si el usuario pidió explícitamente ver ofertas de todos los bancos, no solo los suyos (ej. "dame todas las ofertas"). */
  showAllBanks: boolean;
  /** true si pide ahorrar/la mejor opción en general, sin nombrar comercio ni categoría (ej. "quiero ahorrar hoy", "qué me conviene hacer"). */
  wantsGeneralSavings: boolean;
  /** true si el mensaje acepta/confirma la recomendación anterior de la charla, sin agregar comercio/categoría propios (ej. "me sirve", "dale", "voy ahora", "listo"). Solo tiene efecto si hay contexto reciente que confirmar. */
  confirmsRecommendation: boolean;
  /** true si el mensaje dice que prefiere esperar a una mejora futura ya mencionada en la charla, sin agregar comercio/categoría propios (ej. "mañana entonces", "mejor espero", "capaz la semana que viene"). Solo tiene efecto si hay contexto reciente con una mejora futura. */
  prefersToWait: boolean;
  /** true si el usuario pregunta explícitamente dónde queda/está un comercio (ej. "Chajá donde esta?", "¿dónde queda Ta-Ta?", "en qué dirección está"). merchantName igual debe extraerse si lo nombra — esto es una pregunta ADEMÁS del comercio, no en vez de. */
  asksLocation: boolean;
  /**
   * true si el usuario pide un TIPO de comercio puntual que no es ninguna de
   * las 3 categorías del MVP (ej. "verdulerías", "ferretería", "ropa") — a
   * diferencia de wantsGeneralSavings (que es "sin nombrar categoría"), acá
   * SÍ nombró una, solo que no la tenemos. false en cualquier otro caso,
   * incluso si ya hay merchantName o categoryName.
   */
  unsupportedCategory: boolean;
}
