import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BANK_SCRAPERS,
  BankScraper,
} from '../../domain/scraping/bank-scraper.port';
import { MerchantChain } from '../../../generated/prisma/client';
import { ScrapedPromotion } from '../../domain/scraping/scraped-promotion';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { matchMerchantChain } from '../scraping/merchant-chain-matcher';
import { endOfDay, startOfDay } from '../search/compute-promotion-comparison';
import {
  BankCategoryCoverage,
  BankIngestion,
  CategoryCoverage,
  DataReport,
} from './data-report';

const MAX_SAMPLES = 10;

/**
 * Arma el reporte de datos (ver `DataReport`). Dos modos:
 *
 * - `includeIngestion: false` (default): solo lee la base. Barato, sin
 *   pegarle a ningún banco.
 * - `includeIngestion: true`: además corre los scrapers en seco — trae lo
 *   que publica cada banco hoy y lo clasifica con el MISMO criterio que
 *   SyncPromotionsUseCase, pero sin escribir nada. Sirve para ver cuánto se
 *   pierde antes de la base (ej. promos de comercios que no matchean
 *   ninguna cadena conocida).
 *
 * "Recomendable" no es lo mismo que "cargada": una promo vigente en una
 * cadena sin sucursal verificada nunca se le ofrece a un usuario, así que
 * el reporte cuenta las dos cosas por separado — esa diferencia es la que
 * explica un "no tengo nada confirmado en Montevideo" con la base llena de
 * promos.
 */
@Injectable()
export class BuildDataReportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    // Optional para que el reporte de cobertura siga andando aunque el
    // módulo se instancie sin scrapers (tests, o un futuro runner que solo
    // quiera la foto de la base).
    @Optional()
    @Inject(BANK_SCRAPERS)
    private readonly scrapers: BankScraper[] = [],
  ) {}

  async execute(
    options: { includeIngestion?: boolean; now?: Date } = {},
  ): Promise<DataReport> {
    const now = options.now ?? new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);

    const categories = await this.prisma.category.findMany({
      include: {
        merchantChains: {
          include: {
            branches: { select: { latitude: true, longitude: true } },
            promotions: { include: { bank: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const coverage: CategoryCoverage[] = [];
    const cells = new Map<string, BankCategoryCoverage>();

    for (const category of categories) {
      let chainsWithBranches = 0;
      let branches = 0;
      let activePromotions = 0;
      let recommendablePromotions = 0;
      const chainsWithoutBranchesSamples: string[] = [];

      for (const chain of category.merchantChains) {
        // Mismo criterio que BrowseByCategoryUseCase: una sucursal sin
        // coordenadas no sirve para medir distancia, así que no cuenta como
        // verificada.
        const located = chain.branches.filter(
          (b) => b.latitude !== null && b.longitude !== null,
        );
        branches += located.length;
        if (located.length > 0) {
          chainsWithBranches++;
        } else if (chainsWithoutBranchesSamples.length < MAX_SAMPLES) {
          chainsWithoutBranchesSamples.push(chain.name);
        }

        for (const promo of chain.promotions) {
          const isActive =
            promo.validFrom <= dayEnd && promo.validUntil >= dayStart;
          if (!isActive) continue;
          const isRecommendable = located.length > 0;

          activePromotions++;
          if (isRecommendable) recommendablePromotions++;

          const key = `${promo.bank.name}|${category.name}`;
          const cell = cells.get(key) ?? {
            bankName: promo.bank.name,
            categoryName: category.name,
            activePromotions: 0,
            recommendablePromotions: 0,
          };
          cell.activePromotions++;
          if (isRecommendable) cell.recommendablePromotions++;
          cells.set(key, cell);
        }
      }

      coverage.push({
        categoryName: category.name,
        chains: category.merchantChains.length,
        chainsWithBranches,
        branches,
        activePromotions,
        recommendablePromotions,
        chainsWithoutBranchesSamples,
      });
    }

    const bankCategories = [...cells.values()].sort(
      (a, b) =>
        a.bankName.localeCompare(b.bankName) ||
        a.categoryName.localeCompare(b.categoryName),
    );

    return {
      generatedAt: now,
      categories: coverage,
      bankCategories,
      ingestion: options.includeIngestion ? await this.buildIngestion() : null,
    };
  }

  private async buildIngestion(): Promise<BankIngestion[]> {
    const chains = await this.prisma.merchantChain.findMany();
    const results: BankIngestion[] = [];
    for (const scraper of this.scrapers) {
      results.push(await this.ingestionFor(scraper, chains));
    }
    return results;
  }

  private async ingestionFor(
    scraper: BankScraper,
    chains: MerchantChain[],
  ): Promise<BankIngestion> {
    const empty = {
      bankName: scraper.bankName,
      scraped: 0,
      matchedExistingChain: 0,
      autoCreatableChain: 0,
      dropped: 0,
      droppedSamples: [],
    };

    let scraped: ScrapedPromotion[];
    try {
      scraped = await scraper.scrape();
    } catch (err) {
      // Un banco caído no puede dejar sin reporte a los otros dos — mismo
      // criterio que SyncPromotionsUseCase.
      return {
        ...empty,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let matchedExistingChain = 0;
    let autoCreatableChain = 0;
    const droppedSamples: string[] = [];

    for (const promo of scraped) {
      if (matchMerchantChain(chains, promo.merchantChainName)) {
        matchedExistingChain++;
      } else if (promo.categoryName) {
        autoCreatableChain++;
      } else if (droppedSamples.length < MAX_SAMPLES) {
        droppedSamples.push(promo.merchantChainName);
      }
    }

    return {
      bankName: scraper.bankName,
      scraped: scraped.length,
      matchedExistingChain,
      autoCreatableChain,
      dropped: scraped.length - matchedExistingChain - autoCreatableChain,
      droppedSamples,
    };
  }
}
