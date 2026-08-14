import { PromotionSummary } from '../../domain/search/search-result';
import { RecommendationOption } from '../../domain/recommendation/recommendation';
import { shortAddress } from '../../domain/branches/short-address';

export function toRecommendationOption(
  promotion: PromotionSummary,
  merchantChainName: string,
  branchName: string | null = null,
  neighborhood: string | null = null,
  address: string | null = null,
): RecommendationOption {
  return {
    merchantChainName,
    branchName,
    neighborhood,
    // Recortada acá y no en cada mensaje: así el template determinístico y
    // el Response Generator dicen la misma dirección corta.
    address: shortAddress(address),
    bankName: promotion.bankName,
    discountPercentage: promotion.discountPercentage,
    paymentType: promotion.paymentType,
    cardName: promotion.cardName,
  };
}
