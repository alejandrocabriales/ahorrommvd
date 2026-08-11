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
export interface ScrapedPromotion {
  merchantChainName: string;
  categoryName?: MvpCategoryName;
  discountPercentage: number;
  paymentType: PaymentType;
  cardName?: string;
  capAmount?: number;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string;
}
