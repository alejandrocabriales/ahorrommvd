import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PromotionSummary } from '../../domain/search/search-result';

export interface CategoryOption {
  merchantChainId: string;
  merchantChainName: string;
  today: PromotionSummary;
}

const DEFAULT_LIMIT = 5;

/**
 * Cuando el usuario no nombra un comercio puntual ("voy al súper",
 * "necesito una farmacia") no hay nada que resolver con
 * ResolveMerchantUseCase — en vez de preguntar el nombre exacto, mostramos
 * las mejores promos de hoy en esa categoría para que elija. Solo mira
 * promos de cadena completa (appliesToAllBranches) porque no hay sucursal
 * en juego todavía.
 */
@Injectable()
export class BrowseByCategoryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    categoryName: MvpCategoryName,
    limit = DEFAULT_LIMIT,
  ): Promise<CategoryOption[]> {
    const today = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        appliesToAllBranches: true,
        validFrom: { lte: today },
        validUntil: { gte: today },
        merchantChain: { category: { name: categoryName } },
      },
      include: { bank: true, merchantChain: true },
      orderBy: { discountPercentage: 'desc' },
      take: limit,
    });

    return promotions.map((p) => ({
      merchantChainId: p.merchantChainId,
      merchantChainName: p.merchantChain.name,
      today: {
        bankName: p.bank.name,
        discountPercentage: Number(p.discountPercentage),
        paymentType: p.paymentType,
        cardName: p.cardName,
        capAmount: p.capAmount === null ? null : Number(p.capAmount),
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        sourceUrl: p.sourceUrl,
      },
    }));
  }
}
