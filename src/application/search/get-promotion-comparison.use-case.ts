import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PromotionComparison,
  PromotionSummary,
} from '../../domain/search/search-result';
import {
  addDays,
  computePromotionComparison,
  endOfDay,
  startOfDay,
} from './compute-promotion-comparison';

@Injectable()
export class GetPromotionComparisonUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    merchantChainId: string,
    branchId?: string,
  ): Promise<PromotionComparison> {
    const promotions = await this.getApplicablePromotions(
      merchantChainId,
      branchId,
    );
    return computePromotionComparison(promotions, new Date());
  }

  private async getApplicablePromotions(
    merchantChainId: string,
    branchId?: string,
  ): Promise<PromotionSummary[]> {
    const today = new Date();
    const windowStart = startOfDay(today);
    const windowEnd = endOfDay(addDays(today, 7));

    const promotions = await this.prisma.promotion.findMany({
      where: {
        merchantChainId,
        validFrom: { lte: windowEnd },
        validUntil: { gte: windowStart },
        OR: branchId
          ? [
              { appliesToAllBranches: true },
              { promotionBranches: { some: { branchId } } },
            ]
          : [{ appliesToAllBranches: true }],
      },
      include: { bank: true },
    });

    return promotions.map((p) => ({
      bankName: p.bank.name,
      discountPercentage: Number(p.discountPercentage),
      paymentType: p.paymentType,
      cardName: p.cardName,
      capAmount: p.capAmount === null ? null : Number(p.capAmount),
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      sourceUrl: p.sourceUrl,
    }));
  }
}
