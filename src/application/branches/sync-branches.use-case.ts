import { Inject, Injectable, Logger } from '@nestjs/common';
import { BranchCandidate } from '../../domain/branches/branch-candidate';
import { BRANCH_DIRECTORY_PROVIDER } from '../../domain/branches/branch-directory-provider.port';
import type { BranchDirectoryProvider } from '../../domain/branches/branch-directory-provider.port';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ChainBranchSyncResult {
  chainName: string;
  found: number;
  saved: number;
  error?: string;
}

/**
 * Backfill de sucursales reales vía Google Places, cadena por cadena.
 * Solo procesa cadenas SIN ninguna sucursal cargada — así una corrida
 * repetida (ej. si esto termina en un cron) es casi gratis: lo ya cubierto
 * se saltea, no se re-consulta la API por algo que ya tenemos. Resuelve el
 * gap documentado en PLAN.md: 128/132 cadenas auto-descubiertas por los
 * scrapers de bancos no tenían ni una `Branch`, así que quedaban sin
 * dirección/desambiguación aunque su promo aplicara a toda la cadena.
 */
@Injectable()
export class SyncBranchesUseCase {
  private readonly logger = new Logger(SyncBranchesUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BRANCH_DIRECTORY_PROVIDER)
    private readonly provider: BranchDirectoryProvider,
  ) {}

  async execute(): Promise<ChainBranchSyncResult[]> {
    const chains = await this.prisma.merchantChain.findMany({
      where: { branches: { none: {} } },
    });

    const results: ChainBranchSyncResult[] = [];
    for (const chain of chains) {
      results.push(await this.syncChain(chain.id, chain.name));
    }
    return results;
  }

  private async syncChain(
    chainId: string,
    chainName: string,
  ): Promise<ChainBranchSyncResult> {
    let candidates: BranchCandidate[];
    try {
      candidates = await this.provider.findBranches(chainName);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Places falló para "${chainName}": ${error}`);
      return { chainName, found: 0, saved: 0, error };
    }

    if (candidates.length === 0) {
      return { chainName, found: 0, saved: 0 };
    }

    const named = dedupeNames(candidates);

    // skipDuplicates porque el unique constraint es (merchantChainId, name)
    // — si dedupeNames no alcanzó a desambiguar del todo (colisión rara),
    // mejor guardar las demás y perder solo esa fila que romper todo el
    // batch.
    const { count } = await this.prisma.branch.createMany({
      data: named.map((c) => ({
        merchantChainId: chainId,
        name: c.name,
        address: c.address,
        neighborhood: c.neighborhood,
        latitude: c.latitude,
        longitude: c.longitude,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `${chainName}: ${candidates.length} encontradas, ${count} guardadas`,
    );
    return { chainName, found: candidates.length, saved: count };
  }
}

/**
 * Google puede devolver el mismo texto de nombre para dos sucursales
 * distintas de la misma cadena (ej. dos "Ta-Ta" sin sufijo de barrio en el
 * nombre) — sin desambiguar acá, la segunda chocaría con el unique
 * constraint (merchantChainId, name) y se perdería. Le suma el barrio (o el
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
