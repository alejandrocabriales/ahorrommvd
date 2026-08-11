import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MerchantResolution } from '../../domain/search/branch-resolution';
import { MerchantSearchService } from './merchant-search.service';
import { resolveChainBranches } from './resolve-chain-branches';

export interface ResolveMerchantInput {
  q?: string;
  merchantChainId?: string;
  branchId?: string;
  userId?: string;
}

/**
 * Implementa el flujo de resolución de sucursal del spec: sucursal
 * explícita -> preferida del usuario -> preguntar. El texto libre (`q`) es
 * lo más parecido que tenemos a la interpretación de WhatsApp sin la IA de
 * Semana 4 — matchea contra cadena+sucursal con pg_trgm y, si el mejor
 * resultado ya es una sucursal puntual (ej. "Ta-Ta Pocitos"), se resuelve
 * directo sin volver a preguntar.
 */
@Injectable()
export class ResolveMerchantUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantSearch: MerchantSearchService,
  ) {}

  async execute(input: ResolveMerchantInput): Promise<MerchantResolution> {
    if (input.branchId) {
      return this.resolveByBranchId(input.branchId);
    }
    if (input.merchantChainId) {
      return this.resolveByChainId(input.merchantChainId, input.userId);
    }
    if (input.q) {
      return this.resolveByQuery(input.q, input.userId);
    }
    return { status: 'not_found' };
  }

  private async resolveByBranchId(
    branchId: string,
  ): Promise<MerchantResolution> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { merchantChain: true },
    });
    if (!branch) return { status: 'not_found' };

    return {
      status: 'resolved',
      merchantChainId: branch.merchantChain.id,
      merchantChainName: branch.merchantChain.name,
      branchId: branch.id,
      branchName: branch.name,
    };
  }

  private async resolveByChainId(
    merchantChainId: string,
    userId?: string,
  ): Promise<MerchantResolution> {
    const chain = await this.prisma.merchantChain.findUnique({
      where: { id: merchantChainId },
    });
    if (!chain) return { status: 'not_found' };

    const [branches, preferredBranchId] = await Promise.all([
      this.prisma.branch.findMany({
        where: { merchantChainId },
        select: { id: true, name: true, neighborhood: true },
      }),
      this.getPreferredBranchId(userId),
    ]);

    return resolveChainBranches(
      chain,
      branches.map((b) => ({
        branchId: b.id,
        branchName: b.name,
        neighborhood: b.neighborhood,
      })),
      preferredBranchId,
    );
  }

  private async resolveByQuery(
    q: string,
    userId?: string,
  ): Promise<MerchantResolution> {
    const [best] = await this.merchantSearch.search(q, 1);
    if (!best) return { status: 'not_found' };

    // El mejor resultado ya apunta a una sucursal puntual (ej. matcheó
    // "Ta-Ta Pocitos" contra el nombre de esa sucursal) -> se resuelve
    // directo, no hace falta volver a preguntar cuál.
    if (best.branchId && best.branchName) {
      return {
        status: 'resolved',
        merchantChainId: best.merchantChainId,
        merchantChainName: best.merchantChainName,
        branchId: best.branchId,
        branchName: best.branchName,
      };
    }

    return this.resolveByChainId(best.merchantChainId, userId);
  }

  private async getPreferredBranchId(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredBranchId: true },
    });
    return user?.preferredBranchId ?? null;
  }
}
