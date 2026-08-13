import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PromotionSummary } from '../../domain/search/search-result';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { distanceKm } from '../../domain/geocoding/distance';
import { GeoPoint } from '../../domain/geocoding/geo-point';
import { ZONE_GEOCODER } from '../../domain/geocoding/zone-geocoder.port';
import type { ZoneGeocoder } from '../../domain/geocoding/zone-geocoder.port';
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

// Barrios de Montevideo vecinos suelen estar a 3+ km entre sí (medido:
// Barrio Sur-Pocitos ~3.5km) — 2.5km separa "mismo barrio o uno pegado" de
// "otro barrio", que es justo lo que hace inútil una promo aunque esté
// técnicamente en Montevideo (spec del usuario: "no me sirve un restaurante
// en Pocitos si estoy en Barrio Sur").
const NEARBY_RADIUS_KM = 2.5;

interface CategoryCandidate extends PromotionSummary {
  merchantChainId: string;
  merchantChainName: string;
  /** true si la cadena tiene al menos una `Branch` verificada por el backfill de Google Places (ver `SyncBranchesUseCase`) — es decir, confirmada en Montevideo, no solo "no chequeada todavía". */
  hasVerifiedMontevideoBranch: boolean;
  /** Coordenadas de las sucursales verificadas de esta cadena — [] si no hay ninguna. */
  branchPoints: GeoPoint[];
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
  private readonly logger = new Logger(BrowseByCategoryUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ZONE_GEOCODER) private readonly zoneGeocoder: ZoneGeocoder,
  ) {}

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
      include: {
        bank: true,
        merchantChain: {
          include: {
            branches: { select: { latitude: true, longitude: true } },
          },
        },
      },
    });

    const candidatesRaw: CategoryCandidate[] = promotions.map((p) => {
      const branchPoints: GeoPoint[] = p.merchantChain.branches
        .filter((b) => b.latitude !== null && b.longitude !== null)
        .map((b) => ({ latitude: b.latitude!, longitude: b.longitude! }));
      return {
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
        hasVerifiedMontevideoBranch: branchPoints.length > 0,
        branchPoints,
      };
    });

    // Por default recomendamos solo cadenas con sucursal verificada en
    // Montevideo (spec: "Zona: Montevideo únicamente") — bug real encontrado
    // en vivo: "Soho" ganaba una recomendación de restaurante para "Barrio
    // Sur" con el % más alto sin que nada supiera que el bar real está en
    // Punta del Este. Si ninguna cadena tiene sucursal verificada todavía
    // (categoría recién scrapeada, backfill no corrió aún) mostramos todo
    // sin filtrar — mejor una recomendación sin verificar que "no encontré
    // nada" cuando en realidad sí hay promos.
    const verified = candidatesRaw.filter((c) => c.hasVerifiedMontevideoBranch);
    const candidates = await this.filterByProximity(
      verified.length > 0 ? verified : candidatesRaw,
      zone,
    );

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
      // Preguntar "dónde queda" solo tiene sentido para un comercio puntual
      // (Response Generator necesita un "address" concreto) — a nivel
      // categoría no hay un único lugar que señalar.
      asksLocation: false,
    };
  }

  /**
   * Si conocemos el barrio, filtra a sucursales verificadas dentro de
   * NEARBY_RADIUS_KM — spec del usuario: "no me sirve un restaurante en
   * Pocitos si estoy en Barrio Sur", aunque los dos estén en Montevideo. Sin
   * barrio, si el geocoding falla, o si nada queda lo bastante cerca,
   * devuelve `candidates` sin tocar — mejor mostrar algo en Montevideo que
   * nada. (La distinción "es lo más cercano" vs "es lo único que hay en
   * toda la ciudad" todavía no se comunica en la respuesta — pendiente,
   * junto con preguntar el barrio cuando falta.)
   */
  private async filterByProximity(
    candidates: CategoryCandidate[],
    zone: string | null,
  ): Promise<CategoryCandidate[]> {
    if (!zone) return candidates;

    let zonePoint: GeoPoint | null;
    try {
      zonePoint = await this.zoneGeocoder.geocode(zone);
    } catch (err) {
      this.logger.warn(`No pude geocodificar "${zone}": ${err}`);
      return candidates;
    }
    if (!zonePoint) return candidates;

    const nearby = candidates.filter((c) =>
      c.branchPoints.some(
        (point) => distanceKm(zonePoint!, point) <= NEARBY_RADIUS_KM,
      ),
    );
    return nearby.length > 0 ? nearby : candidates;
  }
}
