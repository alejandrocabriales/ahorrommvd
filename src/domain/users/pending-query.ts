import { MvpCategoryName } from '../scraping/mvp-category';

/**
 * Comercio/categoría que el usuario preguntó antes de que supiéramos qué
 * tarjetas tiene — se guarda para retomarla apenas conteste (o pida
 * "todas") en vez de tener que repetir la pregunta original.
 */
export interface PendingQuery {
  merchantName: string | null;
  branchHint: string | null;
  categoryName: MvpCategoryName | null;
  zone: string | null;
  amount: number | null;
  wantsGeneralSavings: boolean;
}
