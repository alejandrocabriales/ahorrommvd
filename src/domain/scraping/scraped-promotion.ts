import { PaymentType } from '../../../generated/prisma/client';
import { MvpCategoryName } from './mvp-category';

/**
 * Shape a bank scraper must normalize its raw HTML/API data into, before the
 * application layer resolves merchantChainName against known MerchantChains
 * and persists it. Nothing downstream of this type may invent a discount —
 * every field must trace back to what the scraper actually read.
 *
 * categoryName is optional on purpose: a scraper only sets it when it read
 * the category from the bank's own taxonomy with confidence (e.g. Santander
 * exposes a clean "Supermercados"/"Farmacia"/"Ruta Gourmet" facet). When
 * present, the application layer may auto-create a MerchantChain for a
 * merchant we don't know yet. When absent, the merchant can only match an
 * *existing* MerchantChain — we never guess a category.
 */
/**
 * Local que el propio banco publica junto a la promo, con coordenadas y sin
 * dirección (es lo que da el feed de Itaú). Vale más que lo que podamos
 * encontrar después en Google: lo dice quien paga el descuento, y llega sin
 * una llamada más a Places.
 */
export interface ScrapedBranch {
  name: string;
  latitude: number;
  longitude: number;
  /** Calle, cuando el banco la publica (Santander sí, el feed de Itaú no). */
  address?: string;
}

export interface ScrapedPromotion {
  merchantChainName: string;
  categoryName?: MvpCategoryName;
  /**
   * Ausente cuando el beneficio no es un porcentaje — ahí va `benefitLabel`.
   * Uno de los dos tiene que estar; una promo sin ninguno no se persiste.
   */
  discountPercentage?: number;
  /**
   * Beneficio que no se puede expresar como % , con el texto tal cual lo
   * publica el banco ("2x1 en helados de litro y cucuruchos grandes"). Un
   * 2x1 no es "50% menos" — depende de qué lleve el usuario — así que se
   * guarda como lo que es en vez de traducirlo a un número inventado.
   */
  benefitLabel?: string;
  /**
   * Locales de la promo publicados por el banco, ya filtrados a Montevideo
   * por quien scrapea. Vacío/ausente = el banco no los publica, y las
   * sucursales salen del backfill de Places (ver SyncBranchesUseCase).
   */
  branches?: ScrapedBranch[];
  paymentType: PaymentType;
  cardName?: string;
  capAmount?: number;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string;
}
