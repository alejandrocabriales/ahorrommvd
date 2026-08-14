import { Inject, Injectable, Logger } from '@nestjs/common';
import { BranchCandidate } from '../../domain/branches/branch-candidate';
import { distanceKm } from '../../domain/geocoding/distance';
import { BRANCH_DIRECTORY_PROVIDER } from '../../domain/branches/branch-directory-provider.port';
import type { BranchDirectoryProvider } from '../../domain/branches/branch-directory-provider.port';
import { ZONE_GEOCODER } from '../../domain/geocoding/zone-geocoder.port';
import type { ZoneGeocoder } from '../../domain/geocoding/zone-geocoder.port';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ChainBranchSyncResult {
  chainName: string;
  found: number;
  saved: number;
  /** Sucursales que ya estaban ubicadas y a las que les completamos la dirección con Google. */
  addressed: number;
  /** Sucursales que ya existían sin coordenadas y a las que se las completamos geocodificando su dirección. */
  geocoded: number;
  error?: string;
}

/** Sucursal ya cargada, con lo que le falte: sin coordenadas (las del seed) o sin dirección (las del feed de un banco). */
interface ExistingBranch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Dos puntos a menos de esto son el mismo local con distinto nombre — ej.
 * "Freddo Pocitos" (nombre del feed de Itaú) y "Freddo" (nombre en Google),
 * a 30 m. Sirve para dos cosas: no duplicar la sucursal, y pegarle la
 * dirección de Google a la fila que ya teníamos.
 */
const SAME_PLACE_KM = 0.12;

/**
 * Backfill de sucursales reales vía Google Places, cadena por cadena.
 *
 * Procesa las cadenas sin NINGUNA sucursal geolocalizada, no las sin
 * ninguna sucursal: el criterio para recomendar es tener coordenadas (ver
 * BrowseByCategoryUseCase), y las sucursales del seed original (Ta-Ta,
 * Devoto, Farmashop, McDonald's) tienen dirección pero no coordenadas — con
 * el filtro viejo esas cadenas se salteaban para siempre y quedaban
 * invisibles para el motor aunque figuraran "con sucursal" en la base.
 *
 * Dos fases por cadena, las dos idempotentes (upsert por cadena+nombre, que
 * es el unique real):
 *
 *  1. Places: buscar sucursales reales de la cadena.
 *  2. Geocodificar las que ya estaban cargadas con dirección y sin
 *     coordenadas — no las borramos ni las reemplazamos: pueden estar
 *     referenciadas por ahorros registrados o por la sucursal preferida de
 *     un usuario.
 *
 * Resuelve el gap documentado en PLAN.md: la mayoría de las cadenas
 * auto-descubiertas por los scrapers no tenían ni una `Branch`, así que
 * quedaban sin dirección/desambiguación aunque su promo aplicara a toda la
 * cadena.
 */
@Injectable()
export class SyncBranchesUseCase {
  private readonly logger = new Logger(SyncBranchesUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BRANCH_DIRECTORY_PROVIDER)
    private readonly provider: BranchDirectoryProvider,
    @Inject(ZONE_GEOCODER)
    private readonly geocoder: ZoneGeocoder,
  ) {}

  async execute(): Promise<ChainBranchSyncResult[]> {
    const chains = await this.prisma.merchantChain.findMany({
      where: {
        OR: [
          // Sin ninguna sucursal ubicable: hay que salir a buscarlas.
          { branches: { none: { latitude: { not: null } } } },
          // Ubicables pero sin dirección: son las que publica el feed del
          // banco, que da nombre y coordenadas y nada más. Sirven para medir
          // distancia pero no para decirle al usuario dónde queda.
          { branches: { some: { address: null } } },
        ],
      },
      include: {
        category: true,
        branches: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    const results: ChainBranchSyncResult[] = [];
    for (const chain of chains) {
      // Las 3 categorías del MVP están fijas y seedeadas con estos nombres
      // exactos (ver mvp-category.ts) — el cast es seguro mientras eso siga
      // siendo cierto.
      results.push(
        await this.syncChain(
          chain.id,
          chain.name,
          chain.category.name as MvpCategoryName,
          chain.branches,
        ),
      );
    }
    return results;
  }

  private async syncChain(
    chainId: string,
    chainName: string,
    categoryName: MvpCategoryName,
    existing: ExistingBranch[],
  ): Promise<ChainBranchSyncResult> {
    const geocoded = await this.geocodeExisting(chainName, existing);

    let candidates: BranchCandidate[];
    try {
      candidates = await this.provider.findBranches(chainName, categoryName);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Places falló para "${chainName}": ${error}`);
      return { chainName, found: 0, saved: 0, geocoded, addressed: 0, error };
    }

    if (candidates.length === 0) {
      return { chainName, found: 0, saved: 0, geocoded, addressed: 0 };
    }

    // Antes de guardar nada: completar la dirección de las sucursales que ya
    // teníamos ubicadas pero sin dirección (las que publica el feed de un
    // banco, que solo da nombre y coordenadas).
    const addressed = await this.fillAddresses(existing, candidates);

    // Un resultado de Google que cae encima de una sucursal que ya tenemos
    // es la misma, con otro nombre — guardarla duplicaría el local.
    const fresh = candidates.filter(
      (candidate) => !matchExisting(existing, candidate),
    );
    const named = dedupeNames(fresh);

    // Upsert y no createMany: el unique es (merchantChainId, name), así que
    // una corrida repetida completa/corrige la fila que ya estaba en vez de
    // saltearla — que es lo que dejaba a las sucursales del seed sin
    // coordenadas para siempre.
    for (const candidate of named) {
      await this.prisma.branch.upsert({
        where: {
          merchantChainId_name: {
            merchantChainId: chainId,
            name: candidate.name,
          },
        },
        create: {
          merchantChainId: chainId,
          name: candidate.name,
          address: candidate.address,
          neighborhood: candidate.neighborhood,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        },
        update: {
          address: candidate.address,
          neighborhood: candidate.neighborhood,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        },
      });
    }

    this.logger.log(
      `${chainName}: ${candidates.length} encontradas, ${named.length} guardadas` +
        (geocoded > 0 ? `, ${geocoded} geocodificadas` : '') +
        (addressed > 0 ? `, ${addressed} con dirección nueva` : ''),
    );
    return {
      chainName,
      addressed,
      found: candidates.length,
      saved: named.length,
      geocoded,
    };
  }

  /**
   * Al revés que `geocodeExisting`: la sucursal ya está ubicada pero no
   * sabemos su dirección (feed del banco). Si Google tiene un local de la
   * cadena encima de esas coordenadas, le pegamos su dirección — sin eso, la
   * respuesta puede decir "Freddo Pocitos" pero no en qué calle, que es
   * justo lo que el usuario pidió que no pase.
   */
  private async fillAddresses(
    existing: ExistingBranch[],
    candidates: BranchCandidate[],
  ): Promise<number> {
    let addressed = 0;
    for (const branch of existing) {
      if (branch.address || branch.latitude === null) continue;
      const match = candidateAt(branch, candidates);
      if (!match) continue;

      await this.prisma.branch.update({
        where: { id: branch.id },
        data: { address: match.address, neighborhood: match.neighborhood },
      });
      addressed++;
    }
    return addressed;
  }

  /**
   * Completa las coordenadas de sucursales ya cargadas resolviendo su
   * dirección. Un fallo de geocoding (o una dirección que Google no
   * reconoce) deja la fila como estaba: sin coordenadas no se recomienda,
   * que es exactamente lo que ya pasaba.
   */
  private async geocodeExisting(
    chainName: string,
    branches: ExistingBranch[],
  ): Promise<number> {
    let geocoded = 0;
    for (const branch of branches) {
      if (branch.latitude !== null || !branch.address) continue;
      let point: Awaited<ReturnType<ZoneGeocoder['geocode']>>;
      try {
        point = await this.geocoder.geocode(branch.address);
      } catch (err) {
        this.logger.warn(
          `No pude geocodificar "${branch.name}" (${chainName}): ${err}`,
        );
        continue;
      }
      if (!point) continue;

      await this.prisma.branch.update({
        where: { id: branch.id },
        data: { latitude: point.latitude, longitude: point.longitude },
      });
      geocoded++;
    }
    return geocoded;
  }
}

/** El resultado de Google que cae encima de esta sucursal, si hay alguno. */
function candidateAt(
  branch: ExistingBranch,
  candidates: BranchCandidate[],
): BranchCandidate | undefined {
  if (branch.latitude === null || branch.longitude === null) return undefined;
  const point = { latitude: branch.latitude, longitude: branch.longitude };
  return candidates.find(
    (c) =>
      distanceKm(point, { latitude: c.latitude, longitude: c.longitude }) <=
      SAME_PLACE_KM,
  );
}

/** La sucursal que ya tenemos en el mismo lugar que este resultado de Google, si hay alguna. */
function matchExisting(
  existing: ExistingBranch[],
  candidate: BranchCandidate,
): ExistingBranch | undefined {
  return existing.find((branch) => candidateAt(branch, [candidate]));
}

/**
 * Google puede devolver el mismo texto de nombre para dos sucursales
 * distintas de la misma cadena (ej. dos "Ta-Ta" sin sufijo de barrio en el
 * nombre) — sin desambiguar acá, la segunda pisaría a la primera en el
 * upsert por (merchantChainId, name) y se perdería. Le suma el barrio (o el
 * primer tramo de la dirección si no hay barrio) entre paréntesis a partir
 * de la segunda repetición.
 */
function dedupeNames(candidates: BranchCandidate[]): BranchCandidate[] {
  const seen = new Map<string, number>();
  return candidates.map((c) => {
    const count = seen.get(c.name) ?? 0;
    seen.set(c.name, count + 1);
    if (count === 0) return c;
    const suffix = c.neighborhood ?? c.address.split(',')[0];
    return { ...c, name: `${c.name} (${suffix})` };
  });
}
