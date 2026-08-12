import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PromotionSummary } from '../../domain/search/search-result';
import { Recommendation } from '../../domain/recommendation/recommendation';
import {
  activeOn,
  addDays,
  computePromotionComparison,
  endOfDay,
  startOfDay,
} from './compute-promotion-comparison';
import { getAllowedBankNames } from './get-allowed-bank-names';
import { toRecommendationOption } from './recommendation-mapping';
import { computeEstimatedSaving } from './search-message';

const MAX_ALTERNATIVES = 3;

interface CategoryCandidate extends PromotionSummary {
  merchantChainId: string;
  merchantChainName: string;
}

function bestPerChain(candidates: CategoryCandidate[]): CategoryCandidate[] {
  const byChain = new Map<string, CategoryCandidate>();
  for (const c of candidates) {
    const existing = byChain.get(c.merchantChainId);
    if (!existing || c.discountPercentage > existing.discountPercentage) {
      byChain.set(c.merchantChainId, c);
    }
  }
  return [...byChain.values()];
}

/**
 * Cuando el usuario no nombra un comercio puntual ("voy al súper",
 * "necesito una farmacia") no hay nada que resolver con
 * ResolveMerchantUseCase — arma una Recommendation con la mejor opción de
 * la categoría hoy, hasta 3 alternativas, y si conviene esperar (comparando
 * el mejor de la categoría hoy contra el mejor de la categoría en los
 * próximos 7 días). Solo mira promos de cadena completa
 * (appliesToAllBranches) porque no hay sucursal en juego todavía.
 *
 * `categoryName` null = sin categoría puntual, mirá las 3 del MVP juntas
 * (ej. "quiero ahorrar hoy", "qué me conviene hacer" — el usuario no dijo
 * ni comercio ni categoría, quiere la mejor oferta de Montevideo).
 *
 * `amount` es opcional y solo llega de un mensaje de seguimiento (ej.
 * "farmacias" y después "600 pesos") — cuando está, calculamos el ahorro
 * en pesos contra `bestToday`, igual que ya hace el flujo de comercio
 * puntual en `buildRecommendationFromSearch`.
 */
@Injectable()
export class BrowseByCategoryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    categoryName: MvpCategoryName | null,
    zone: string | null,
    userId?: string,
    amount?: number,
  ): Promise<Recommendation> {
    const today = new Date();
    const allowedBankNames = await getAllowedBankNames(this.prisma, userId);

    const promotions = await this.prisma.promotion.findMany({
      where: {
        appliesToAllBranches: true,
        validFrom: { lte: endOfDay(addDays(today, 7)) },
        validUntil: { gte: startOfDay(today) },
        ...(categoryName
          ? { merchantChain: { category: { name: categoryName } } }
          : {}),
        ...(allowedBankNames
          ? { bank: { name: { in: [...allowedBankNames] } } }
          : {}),
      },
      include: { bank: true, merchantChain: true },
    });

    const candidates: CategoryCandidate[] = promotions.map((p) => ({
      merchantChainId: p.merchantChainId,
      merchantChainName: p.merchantChain.name,
      bankName: p.bank.name,
      discountPercentage: Number(p.discountPercentage),
      paymentType: p.paymentType,
      cardName: p.cardName,
      capAmount: p.capAmount === null ? null : Number(p.capAmount),
      validFrom: p.validFrom,
      validUntil: p.validUntil,
      sourceUrl: p.sourceUrl,
    }));

    const comparison = computePromotionComparison(candidates, today);
    const estimatedSaving = computeEstimatedSaving(comparison.today, amount);
    const estimatedSavingBetterSoon = comparison.better
      ? computeEstimatedSaving(comparison.better.promotion, amount)
      : null;

    const todayActive = bestPerChain(activeOn(candidates, today)).sort(
      (a, b) => b.discountPercentage - a.discountPercentage,
    );
    const alternatives = todayActive
      .filter((c) => c.merchantChainId !== comparison.today?.merchantChainId)
      .slice(0, MAX_ALTERNATIVES);

    return {
      queryLabel: categoryName ?? 'lo mejor de hoy en Montevideo',
      zone,
      bestToday: comparison.today
        ? toRecommendationOption(
            comparison.today,
            comparison.today.merchantChainName,
          )
        : null,
      alternatives: alternatives.map((c) =>
        toRecommendationOption(c, c.merchantChainName),
      ),
      betterSoon: comparison.better
        ? {
            option: toRecommendationOption(
              comparison.better.promotion,
              comparison.better.promotion.merchantChainName,
            ),
            daysFromNow: comparison.better.daysFromNow,
            estimatedSaving: estimatedSavingBetterSoon
              ? {
                  amount: estimatedSavingBetterSoon.amount,
                  cappedByBank: estimatedSavingBetterSoon.cappedByBank,
                }
              : null,
          }
        : null,
      estimatedSavingToday: estimatedSaving
        ? {
            amount: estimatedSaving.amount,
            cappedByBank: estimatedSaving.cappedByBank,
          }
        : null,
      nothingFound: !comparison.today && !comparison.better,
      spentAmount: amount ?? null,
    };
  }
}
