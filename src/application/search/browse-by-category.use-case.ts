import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PromotionSummary } from '../../domain/search/search-result';
import {
  LabeledBenefit,
  Recommendation,
  RecommendationOption,
} from '../../domain/recommendation/recommendation';
import { shortAddress } from '../../domain/branches/short-address';
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

/** Beneficio sin porcentaje (ej. "2x1 en helados"): mismo estándar de sucursal, pero fuera del ranking. */
interface LabeledCandidate {
  merchantChainName: string;
  bankName: string;
  label: string;
  validFrom: Date;
  validUntil: Date;
  branches: VerifiedBranch[];
}

/** Cuántos beneficios sin % ofrecemos: son un extra, no la respuesta. */
const MAX_OTHER_BENEFITS = 2;

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
 * Contexto del pedido tal como lo hizo el usuario, para que la respuesta
 * hable de eso y no del nombre interno de la categoría. Lo arma quien
 * traduce la necesidad a categorías (ver `UserNeed`); este caso de uso no
 * sabe nada de necesidades, solo de dónde buscar.
 */
export interface BrowseRequestContext {
  /** Cómo nombrarle al usuario lo que pidió, ej. "lugares para comer". */
  label?: string;
  /** Productos que nombró ("arroz", "tomate") — informativo, no hay precios. */
  items?: string[];
}

/**
 * Cuando el usuario no nombra un comercio puntual ("voy al súper",
 * "necesito una farmacia") no hay nada que resolver con
 * ResolveMerchantUseCase — arma una Recommendation con la mejor opción de
 * hoy entre las categorías donde tiene sentido buscar, hasta 3 alternativas,
 * y si conviene esperar (comparando el mejor de hoy contra el mejor de los
 * próximos 7 días). Solo mira promos de cadena completa
 * (appliesToAllBranches) porque no hay sucursal en juego todavía.
 *
 * `category` acepta una sola o varias: una necesidad puede resolverse en más
 * de un tipo de comercio (el shampoo está tanto en el súper como en la
 * farmacia) y quedarnos con una sola sería descartar promos reales por una
 * decisión de taxonomía nuestra. null = sin categoría puntual, mirá las 3 del
 * MVP juntas (ej. "quiero ahorrar hoy" — el usuario no dijo ni comercio ni
 * necesidad, quiere la mejor oferta de Montevideo).
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
    category: MvpCategoryName | readonly MvpCategoryName[] | null,
    zone: string | null,
    userId?: string,
    amount?: number,
    request?: BrowseRequestContext,
  ): Promise<Recommendation> {
    const today = new Date();
    const categoryNames =
      category === null
        ? null
        : typeof category === 'string'
          ? [category]
          : [...category];
    const allowedBankNames = await getAllowedBankNames(this.prisma, userId);

    const promotions = await this.prisma.promotion.findMany({
      where: {
        appliesToAllBranches: true,
        validFrom: { lte: endOfDay(addDays(today, 7)) },
        validUntil: { gte: startOfDay(today) },
        // Un array VACÍO no es lo mismo que null: null es "mirá todo", []
        // es "no hay ninguna categoría donde buscar esto" (lo que devuelve
        // `categoriesForNeed` para una necesidad que no cubrimos). `in: []`
        // no matchea nada, que es la respuesta correcta — si en cambio
        // salteáramos el filtro, pedir una ferretería terminaría devolviendo
        // promos de supermercado, justo lo que el producto no debe hacer.
        ...(categoryNames
          ? { merchantChain: { category: { name: { in: categoryNames } } } }
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

    const branchesOf = (p: (typeof promotions)[number]): VerifiedBranch[] =>
      p.merchantChain.branches
        .filter((b) => b.latitude !== null && b.longitude !== null)
        .map((b) => ({
          name: b.name,
          neighborhood: b.neighborhood,
          address: b.address,
          point: { latitude: b.latitude!, longitude: b.longitude! },
        }));

    const candidatesRaw: CategoryCandidate[] = promotions
      .filter((p) => p.discountPercentage !== null)
      .map((p) => ({
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
        branches: branchesOf(p),
      }));

    // Beneficios que no son un % (hoy: los 2x1 de Freddo y Las Delicias en
    // Itaú). Van por su propio carril: un 2x1 no se puede ordenar contra un
    // 25% sin inventar una equivalencia, así que nunca compiten por
    // "bestToday" — se ofrecen aparte.
    const labeledRaw: LabeledCandidate[] = promotions
      .filter((p) => p.benefitLabel !== null && p.discountPercentage === null)
      .map((p) => ({
        merchantChainName: p.merchantChain.name,
        bankName: p.bank.name,
        label: p.benefitLabel!,
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        branches: branchesOf(p),
      }));

    const zonePoint = await this.geocodeZone(zone);
    const mineOf = <T extends { bankName: string }>(list: T[]): T[] =>
      allowedBankNames
        ? list.filter((c) => allowedBankNames.has(c.bankName))
        : list;
    const mine = mineOf(candidatesRaw);
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
      queryLabel:
        request?.label ??
        (categoryNames?.length ? categoryNames.join(' y ') : null) ??
        'lo mejor de hoy en Montevideo',
      requestedItems: request?.items ?? [],
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
      otherBenefits: this.toLabeledBenefits(
        mineOf(labeledRaw),
        zonePoint,
        today,
      ),
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
   * Beneficios sin % vigentes hoy, con el mismo estándar de ubicación que
   * una recomendación (sucursal verificada, y cerca si sabemos el barrio).
   * No se ordenan por "mejor" — no hay con qué — así que salen los más
   * cercanos primero cuando conocemos el barrio.
   */
  private toLabeledBenefits(
    all: LabeledCandidate[],
    zonePoint: GeoPoint | null,
    today: Date,
  ): LabeledBenefit[] {
    const dayStart = startOfDay(today);
    const dayEnd = endOfDay(today);
    const activeToday = all.filter(
      (c) => c.validFrom <= dayEnd && c.validUntil >= dayStart,
    );
    const { candidates } = selectRecommendable(activeToday, zonePoint);

    return candidates.slice(0, MAX_OTHER_BENEFITS).map((candidate) => {
      const branch = nearestBranch(candidate.branches, zonePoint);
      return {
        merchantChainName: candidate.merchantChainName,
        branchName: branch?.name ?? null,
        neighborhood: branch?.neighborhood ?? null,
        address: shortAddress(branch?.address ?? null),
        bankName: candidate.bankName,
        label: candidate.label,
      };
    });
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
function selectRecommendable<T extends { branches: VerifiedBranch[] }>(
  all: T[],
  zonePoint: GeoPoint | null,
): {
  candidates: T[];
  verified: T[];
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

  const selected = nearby.length > 0 ? nearby : verified;

  // Ordenar por cercanía acá adentro es lo que desempata más adelante: los
  // sorts por porcentaje son estables, así que entre dos promos del mismo %
  // gana la que está más cerca. Sin esto, con 60 restaurantes de Itaú todos
  // al 15% en Montevideo, "el mejor de hoy" salía en un orden arbitrario y
  // podía mandar al usuario al otro lado del barrio.
  const sorted = zonePoint
    ? [...selected].sort(
        (a, b) =>
          nearestDistanceKm(a.branches, zonePoint) -
          nearestDistanceKm(b.branches, zonePoint),
      )
    : selected;

  return {
    verified,
    candidates: sorted,
    zoneWidened:
      Boolean(zonePoint) && verified.length > 0 && nearby.length === 0,
  };
}

function nearestDistanceKm(
  branches: VerifiedBranch[],
  zonePoint: GeoPoint,
): number {
  return Math.min(...branches.map((b) => distanceKm(zonePoint, b.point)));
}

function nearestBranch(
  branches: VerifiedBranch[],
  zonePoint: GeoPoint | null,
): VerifiedBranch | null {
  if (branches.length === 0) return null;
  // Sin barrio no podemos elegir la más cercana, pero si la cadena tiene una
  // sola sucursal no hay nada que elegir: nombrarla es un dato real, no una
  // ubicación inventada. Antes devolvíamos null también en ese caso y la
  // respuesta salía sin dirección (bug del 14/8: "25% en Bruta", a 230m del
  // usuario, sin decir dónde queda).
  if (!zonePoint) return branches.length === 1 ? branches[0] : null;
  return [...branches].sort(
    (a, b) => distanceKm(zonePoint, a.point) - distanceKm(zonePoint, b.point),
  )[0];
}
