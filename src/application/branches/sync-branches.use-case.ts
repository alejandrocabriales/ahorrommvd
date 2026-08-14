import { Inject, Injectable, Logger } from '@nestjs/common';
import { BranchCandidate } from '../../domain/branches/branch-candidate';
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
  /** Sucursales que ya existían sin coordenadas y a las que se las completamos geocodificando su dirección. */
  geocoded: number;
  error?: string;
}

/** Sucursal ya cargada que todavía no sirve para recomendar: tiene dirección pero no coordenadas. */
interface ExistingBranch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
}

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
      where: { branches: { none: { latitude: { not: null } } } },
      include: {
        category: true,
        branches: {
          select: { id: true, name: true, address: true, latitude: true },
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
      return { chainName, found: 0, saved: 0, geocoded, error };
    }

    if (candidates.length === 0) {
      return { chainName, found: 0, saved: 0, geocoded };
    }

    const named = dedupeNames(candidates);

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
        (geocoded > 0 ? `, ${geocoded} geocodificadas` : ''),
    );
    return {
      chainName,
      found: candidates.length,
      saved: named.length,
      geocoded,
    };
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
