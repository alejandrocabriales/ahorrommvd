import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PromotionSummary } from '../../domain/search/search-result';
import {
  Recommendation,
  RecommendationOption,
} from '../../domain/recommendation/recommendation';
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

/** Sucursal real y ubicable de una cadena — viene del backfill de Google Places (ver `SyncBranchesUseCase`), no de un scraper. */
interface VerifiedBranch {
  name: string;
  neighborhood: string | null;
  address: string | null;
  point: GeoPoint;
}

interface CategoryCandidate extends PromotionSummary {
  merchantChainId: string;
  merchantChainName: string;
  /** Sucursales de la cadena confirmadas en Montevideo con coordenadas — [] si no hay ninguna, y ahí la cadena no se recomienda. */
  branches: VerifiedBranch[];
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
        // El filtro por banco NO va acá: traemos todo y filtramos en
        // memoria (son decenas de filas, no miles) para poder responder
        // "con tus tarjetas no hay, pero con Santander sí" en vez de
        // dejar al usuario en un no seco.
      },
      include: {
        bank: true,
        merchantChain: {
          include: {
            branches: {
              select: {
                name: true,
                neighborhood: true,
                address: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    const candidatesRaw: CategoryCandidate[] = promotions.map((p) => {
      const branches: VerifiedBranch[] = p.merchantChain.branches
        .filter((b) => b.latitude !== null && b.longitude !== null)
        .map((b) => ({
          name: b.name,
          neighborhood: b.neighborhood,
          address: b.address,
          point: { latitude: b.latitude!, longitude: b.longitude! },
        }));
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
        branches,
      };
    });

    const zonePoint = await this.geocodeZone(zone);
    const mine = allowedBankNames
      ? candidatesRaw.filter((c) => allowedBankNames.has(c.bankName))
      : candidatesRaw;
    const { candidates, verified, zoneWidened } = selectRecommendable(
      mine,
      zonePoint,
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

    const nothingFound = !comparison.today && !comparison.better;

    return {
      queryLabel: categoryName ?? 'lo mejor de hoy en Montevideo',
      zone,
      bestToday: comparison.today
        ? this.toOption(comparison.today, zonePoint)
        : null,
      alternatives: alternatives.map((c) => this.toOption(c, zonePoint)),
      betterSoon: comparison.better
        ? {
            option: this.toOption(comparison.better.promotion, zonePoint),
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
      nothingFound,
      spentAmount: amount ?? null,
      // Había promos vigentes de la categoría, pero ninguna en una cadena
      // que podamos confirmar en Montevideo — no recomendamos ninguna, y
      // esto le dice a la respuesta por qué no es lo mismo que "no hay
      // promos".
      unverifiedOnly: verified.length === 0 && mine.length > 0,
      zoneWidened,
      // Con SUS tarjetas no hay nada, pero con otro banco sí y está
      // confirmado igual que el resto — decirlo es más útil que un "no
      // tengo nada" seco, y no es una recomendación: no puede usarla salvo
      // que tenga esa tarjeta.
      bestWithOtherBank:
        nothingFound && allowedBankNames
          ? this.bestOutsideMyBanks(
              candidatesRaw,
              allowedBankNames,
              zonePoint,
              today,
            )
          : null,
      // Preguntar "dónde queda" solo tiene sentido para un comercio puntual
      // (Response Generator necesita un "address" concreto) — a nivel
      // categoría no hay un único lugar que señalar.
      asksLocation: false,
    };
  }

  /**
   * La mejor opción de hoy entre los bancos que el usuario NO tiene, con el
   * mismo estándar que una recomendación de verdad (sucursal verificada y,
   * si sabemos el barrio, cerca). Solo se usa cuando con sus tarjetas no hay
   * nada: sirve para que el "no tengo nada" diga qué se está perdiendo, no
   * para recomendarle algo que no puede pagar.
   */
  private bestOutsideMyBanks(
    all: CategoryCandidate[],
    allowedBankNames: Set<string>,
    zonePoint: GeoPoint | null,
    today: Date,
  ): RecommendationOption | null {
    const others = all.filter((c) => !allowedBankNames.has(c.bankName));
    const { candidates } = selectRecommendable(others, zonePoint);
    const best = computePromotionComparison(candidates, today).today;
    return best ? this.toOption(best, zonePoint) : null;
  }

  /**
   * Sucursal concreta que le vamos a nombrar al usuario: la más cercana a su
   * barrio cuando lo conocemos. Sin barrio geocodificado no elegimos ninguna
   * — una cadena puede tener 20 sucursales y señalar una al azar sería
   * inventarle una ubicación.
   */
  private toOption(candidate: CategoryCandidate, zonePoint: GeoPoint | null) {
    const branch = nearestBranch(candidate.branches, zonePoint);
    return toRecommendationOption(
      candidate,
      candidate.merchantChainName,
      branch?.name ?? null,
      branch?.neighborhood ?? null,
      branch?.address ?? null,
    );
  }

  /**
   * Resuelve el barrio del usuario a coordenadas para poder medir distancia
   * real ("no me sirve un restaurante en Pocitos si estoy en Barrio Sur").
   * Si no hay barrio, o el geocoding falla/no lo reconoce, devolvemos null y
   * el flujo sigue sin filtro de cercanía — un problema de geocoding no
   * puede dejar al usuario sin respuesta.
   */
  private async geocodeZone(zone: string | null): Promise<GeoPoint | null> {
    if (!zone) return null;
    try {
      return await this.zoneGeocoder.geocode(zone);
    } catch (err) {
      this.logger.warn(`No pude geocodificar "${zone}": ${err}`);
      return null;
    }
  }
}

/**
 * Filtra a lo que de verdad se puede recomendar: solo cadenas con sucursal
 * verificada en Montevideo (spec: "Zona: Montevideo únicamente") y, si
 * sabemos el barrio, las que tengan una sucursal cerca. Antes había un
 * fallback que mostraba las no verificadas "mejor que decir no encontré
 * nada", y en vivo terminó ofreciendo Soho (Punta del Este) y Chajá a un
 * usuario Itaú+OCA que preguntó dónde comer: exactamente lo que el usuario
 * pidió que no pase ("si no tiene nada, no debe inventar").
 *
 * `zoneWidened`: nada confirmado en el barrio del usuario pero sí en otra
 * parte de Montevideo — seguimos recomendando (mejor eso que nada) pero
 * queda marcado para que la respuesta lo diga en vez de hacerlo pasar por
 * "cerca tuyo".
 */
function selectRecommendable(
  all: CategoryCandidate[],
  zonePoint: GeoPoint | null,
): {
  candidates: CategoryCandidate[];
  verified: CategoryCandidate[];
  zoneWidened: boolean;
} {
  const verified = all.filter((c) => c.branches.length > 0);
  const nearby = zonePoint
    ? verified.filter((c) =>
        c.branches.some(
          (b) => distanceKm(zonePoint, b.point) <= NEARBY_RADIUS_KM,
        ),
      )
    : verified;

  return {
    verified,
    candidates: nearby.length > 0 ? nearby : verified,
    zoneWidened:
      Boolean(zonePoint) && verified.length > 0 && nearby.length === 0,
  };
}

function nearestBranch(
  branches: VerifiedBranch[],
  zonePoint: GeoPoint | null,
): VerifiedBranch | null {
  if (!zonePoint || branches.length === 0) return null;
  return [...branches].sort(
    (a, b) => distanceKm(zonePoint, a.point) - distanceKm(zonePoint, b.point),
  )[0];
}
