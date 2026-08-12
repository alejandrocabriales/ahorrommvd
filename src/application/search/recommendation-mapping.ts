import { PromotionSummary } from '../../domain/search/search-result';
import { RecommendationOption } from '../../domain/recommendation/recommendation';

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
    address,
    bankName: promotion.bankName,
    discountPercentage: promotion.discountPercentage,
    paymentType: promotion.paymentType,
    cardName: promotion.cardName,
  };
}
