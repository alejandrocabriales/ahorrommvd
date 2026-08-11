import { PaymentType } from '../../../generated/prisma/client';

/** Un match de búsqueda: puede ser una sucursal puntual o, si la cadena no
 * tiene sucursales cargadas (la mayoría de lo que traen los scrapers), la
 * cadena entera. */
export interface MerchantMatch {
  merchantChainId: string;
  merchantChainName: string;
  categoryName: string;
  branchId?: string;
  branchName?: string;
  neighborhood?: string;
  score: number;
}

export interface PromotionSummary {
  bankName: string;
  discountPercentage: number;
  paymentType: PaymentType;
  cardName: string | null;
  capAmount: number | null;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string;
}

export interface PromotionComparison {
  today: PromotionSummary | null;
  /** La mejor promo de los próximos 7 días que le gana a la de hoy (si existe). */
  better: { promotion: PromotionSummary; daysFromNow: number } | null;
  /** Todo lo vigente en la ventana [hoy, hoy+7], sin filtrar — para GET /promotions/upcoming. */
  upcoming: PromotionSummary[];
}
