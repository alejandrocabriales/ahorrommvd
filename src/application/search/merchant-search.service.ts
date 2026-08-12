import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MerchantMatch } from '../../domain/search/search-result';

// Umbral de similaridad de pg_trgm. Usamos similarity() explícito en vez del
// operador `%` porque `%` depende de la GUC de sesión pg_trgm.similarity_threshold
// (default 0.3) — con conexiones pooleadas (PrismaPg reutiliza conexiones) un
// `SET` de sesión podría filtrarse a queries no relacionadas. Validado contra
// los casos del spec (tata, tta, positos, punta carreta) con 0.2.
const SIMILARITY_THRESHOLD = 0.2;
const DEFAULT_LIMIT = 10;

interface ChainRow {
  merchantChainId: string;
  merchantChainName: string;
  categoryName: string;
  score: number;
}

interface BranchRow {
  merchantChainId: string;
  merchantChainName: string;
  categoryName: string;
  branchId: string;
  branchName: string;
  neighborhood: string | null;
  address: string | null;
  score: number;
}

/**
 * Búsqueda tolerante a errores con pg_trgm. Busca en dos niveles porque la
 * mayoría de las cadenas que trajeron los scrapers (Semana 2) no tienen
 * ninguna sucursal cargada — si solo buscáramos en `branches` esas cadenas
 * serían invisibles.
 */
@Injectable()
export class MerchantSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca a nivel cadena Y a nivel sucursal, y deja que el score decida
   * cuál gana — nada de "si hay un hit de sucursal, descarto el de cadena"
   * (eso fue un bug: probado en vivo, "Ta-Ta" solo resolvía directo a
   * Pocitos en vez de preguntar). "Ta-Ta" sola matchea la cadena con score
   * 1.0 (exacto) pero cualquier sucursal "Ta-Ta *" apenas ~0.2-0.27
   * (comparten el prefijo, nada más) — tiene que ganar la cadena ahí para
   * que dispare "¿en cuál Ta-Ta?". "Ta-Ta Pocitos", en cambio, matchea esa
   * sucursal con score 1.0 (exacto) contra 0.27 de la cadena sola — gana
   * la sucursal, sin preguntar. Validado con similarity() real contra los
   * datos seedeados.
   */
  async search(query: string, limit = DEFAULT_LIMIT): Promise<MerchantMatch[]> {
    const [chains, branches] = await Promise.all([
      this.searchChains(query, limit),
      this.searchBranches(query, limit),
    ]);

    const results: MerchantMatch[] = [
      ...branches.map((b) => ({
        merchantChainId: b.merchantChainId,
        merchantChainName: b.merchantChainName,
        categoryName: b.categoryName,
        branchId: b.branchId,
        branchName: b.branchName,
        neighborhood: b.neighborhood ?? undefined,
        address: b.address ?? undefined,
        score: b.score,
      })),
      ...chains.map((c) => ({
        merchantChainId: c.merchantChainId,
        merchantChainName: c.merchantChainName,
        categoryName: c.categoryName,
        score: c.score,
      })),
    ];

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Solo sucursales puntuales — lo que espera GET /branches/search. */
  async searchBranchesOnly(
    query: string,
    limit = DEFAULT_LIMIT,
  ): Promise<MerchantMatch[]> {
    const branches = await this.searchBranches(query, limit);
    return branches.map((b) => ({
      merchantChainId: b.merchantChainId,
      merchantChainName: b.merchantChainName,
      categoryName: b.categoryName,
      branchId: b.branchId,
      branchName: b.branchName,
      neighborhood: b.neighborhood ?? undefined,
      address: b.address ?? undefined,
      score: b.score,
    }));
  }

  private searchChains(query: string, limit: number): Promise<ChainRow[]> {
    return this.prisma.$queryRaw<ChainRow[]>(Prisma.sql`
      SELECT
        mc.id AS "merchantChainId",
        mc.name AS "merchantChainName",
        c.name AS "categoryName",
        similarity(mc.name, ${query}) AS score
      FROM merchant_chains mc
      JOIN categories c ON c.id = mc.category_id
      WHERE similarity(mc.name, ${query}) > ${SIMILARITY_THRESHOLD}
      ORDER BY score DESC
      LIMIT ${limit}
    `);
  }

  private searchBranches(query: string, limit: number): Promise<BranchRow[]> {
    return this.prisma.$queryRaw<BranchRow[]>(Prisma.sql`
      SELECT
        mc.id AS "merchantChainId",
        mc.name AS "merchantChainName",
        c.name AS "categoryName",
        b.id AS "branchId",
        b.name AS "branchName",
        b.neighborhood AS "neighborhood",
        b.address AS "address",
        GREATEST(
          similarity(b.name, ${query}),
          similarity(coalesce(b.neighborhood, ''), ${query})
        ) AS score
      FROM branches b
      JOIN merchant_chains mc ON mc.id = b.merchant_chain_id
      JOIN categories c ON c.id = mc.category_id
      WHERE similarity(b.name, ${query}) > ${SIMILARITY_THRESHOLD}
         OR similarity(coalesce(b.neighborhood, ''), ${query}) > ${SIMILARITY_THRESHOLD}
      ORDER BY score DESC
      LIMIT ${limit}
    `);
  }
}
