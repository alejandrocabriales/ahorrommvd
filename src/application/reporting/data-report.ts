/**
 * Foto del estado real de los datos, en dos mitades que responden preguntas
 * distintas:
 *
 * - `coverage` (lo que hay en la base): de todo lo que scrapeamos, ¿cuánto
 *   es realmente recomendable? Una promo vigente en una cadena sin sucursal
 *   verificada no se le puede ofrecer a nadie (ver BrowseByCategoryUseCase),
 *   así que contarla como "promo cargada" esconde el problema.
 * - `ingestion` (lo que traen los scrapers ahora): de todo lo que la página
 *   del banco publica, ¿cuánto llega a la base y cuánto se cae en el camino?
 *
 * Existe porque el diagnóstico de por qué el bot no encontraba restaurantes
 * con Itaú hubo que sacarlo a mano con SQL contra producción — sin este
 * reporte, cada cambio en scrapers o backfill se evalúa a ciegas.
 */
export interface CategoryCoverage {
  categoryName: string;
  chains: number;
  /** Cadenas con al menos una sucursal geolocalizada — las únicas que el motor puede recomendar. */
  chainsWithBranches: number;
  branches: number;
  activePromotions: number;
  /** Promos vigentes hoy cuya cadena SÍ tiene sucursal verificada. La diferencia contra `activePromotions` es lo que hoy se pierde. */
  recommendablePromotions: number;
  /** Primeras cadenas sin sucursal, para tener a mano contra qué probar el backfill. */
  chainsWithoutBranchesSamples: string[];
}

/** Una celda banco × categoría: es la vista que muestra "Itaú tiene 1 sola promo de Restaurantes". */
export interface BankCategoryCoverage {
  bankName: string;
  categoryName: string;
  activePromotions: number;
  recommendablePromotions: number;
}

/**
 * Embudo de un scraper, calculado sin escribir nada: mismo criterio que
 * SyncPromotionsUseCase (matchear cadena existente, o crearla si el scraper
 * trajo categoría confiable), para poder ver cuánto se cae y por qué antes
 * de tocar la base.
 */
export interface BankIngestion {
  bankName: string;
  scraped: number;
  matchedExistingChain: number;
  /** Sin cadena conocida, pero el scraper trajo categoría — el sync la crearía. */
  autoCreatableChain: number;
  /** Sin cadena y sin categoría: se pierde en silencio. */
  dropped: number;
  droppedSamples: string[];
  error?: string;
}

export interface DataReport {
  generatedAt: Date;
  categories: CategoryCoverage[];
  bankCategories: BankCategoryCoverage[];
  /** null cuando se pidió el reporte sin correr los scrapers (solo foto de la base). */
  ingestion: BankIngestion[] | null;
}
