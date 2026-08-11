import { Inject, Injectable, Logger } from '@nestjs/common';
import { MerchantChain } from '../../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  BANK_SCRAPERS,
  BankScraper,
} from '../../domain/scraping/bank-scraper.port';
import { matchMerchantChain } from './merchant-chain-matcher';

export interface BankSyncResult {
  bankName: string;
  scraped: number;
  persisted: number;
  autoCreatedChains: number;
  skippedUnmatchedChain: number;
  error?: string;
}

/**
 * Por banco: scrapea, resuelve cada promo contra un MerchantChain (matchea
 * uno existente o, si el scraper trajo una categoría confiable, crea uno
 * nuevo — ver ScrapedPromotion.categoryName), y reemplaza por completo las
 * promociones de ese banco (delete + create).
 *
 * ¿Por qué reemplazar en vez de upsertear por clave natural? Igual que en
 * el seed: no hay una clave natural real para una promoción bancaria, y el
 * scraper corre diario — la foto de "qué está vigente ahora en la página del
 * banco" siempre reemplaza a la anterior. Si algo no vuelve a matchear
 * (ej. terminó la promo) simplemente desaparece de la base.
 *
 * Un banco fallando (ej. el sitio cambió de estructura) no debe tumbar la
 * sync de los otros dos — cada scraper corre aislado y se loguea el error.
 */
@Injectable()
export class SyncPromotionsUseCase {
  private readonly logger = new Logger(SyncPromotionsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BANK_SCRAPERS) private readonly scrapers: BankScraper[],
  ) {}

  async execute(): Promise<BankSyncResult[]> {
    const [chains, categories] = await Promise.all([
      this.prisma.merchantChain.findMany(),
      this.prisma.category.findMany(),
    ]);
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

    const results: BankSyncResult[] = [];
    for (const scraper of this.scrapers) {
      // `chains` se pasa por referencia y syncBank le hace push a las que
      // va creando, para que el banco siguiente en este mismo loop ya las
      // vea como existentes en vez de intentar crearlas de nuevo.
      results.push(await this.syncBank(scraper, chains, categoryIdByName));
    }

    return results;
  }

  private async syncBank(
    scraper: BankScraper,
    chains: MerchantChain[],
    categoryIdByName: Map<string, string>,
  ): Promise<BankSyncResult> {
    const bank = await this.prisma.bank.findUnique({
      where: { name: scraper.bankName },
    });
    if (!bank) {
      const error = `Banco "${scraper.bankName}" no existe en la base (¿falta en el seed?)`;
      this.logger.error(error);
      return {
        bankName: scraper.bankName,
        scraped: 0,
        persisted: 0,
        autoCreatedChains: 0,
        skippedUnmatchedChain: 0,
        error,
      };
    }

    let scraped: Awaited<ReturnType<BankScraper['scrape']>>;
    try {
      scraped = await scraper.scrape();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scraper de ${scraper.bankName} falló: ${error}`);
      return {
        bankName: scraper.bankName,
        scraped: 0,
        persisted: 0,
        autoCreatedChains: 0,
        skippedUnmatchedChain: 0,
        error,
      };
    }

    let skippedUnmatchedChain = 0;
    let autoCreatedChains = 0;
    const toPersist: Array<
      (typeof scraped)[number] & { merchantChainId: string }
    > = [];

    for (const promo of scraped) {
      let chain = matchMerchantChain(chains, promo.merchantChainName);

      if (!chain && promo.categoryName) {
        const categoryId = categoryIdByName.get(promo.categoryName);
        if (categoryId) {
          chain = await this.prisma.merchantChain.upsert({
            where: { name: promo.merchantChainName },
            update: {},
            create: { name: promo.merchantChainName, categoryId },
          });
          chains.push(chain);
          autoCreatedChains++;
          this.logger.log(
            `Cadena nueva descubierta vía ${scraper.bankName}: "${chain.name}" (${promo.categoryName})`,
          );
        }
      }

      if (!chain) {
        skippedUnmatchedChain++;
        continue;
      }
      toPersist.push({ ...promo, merchantChainId: chain.id });
    }

    await this.prisma.$transaction([
      this.prisma.promotion.deleteMany({ where: { bankId: bank.id } }),
      ...toPersist.map((promo) =>
        this.prisma.promotion.create({
          data: {
            bankId: bank.id,
            merchantChainId: promo.merchantChainId,
            discountPercentage: promo.discountPercentage,
            paymentType: promo.paymentType,
            cardName: promo.cardName,
            capAmount: promo.capAmount,
            validFrom: promo.validFrom,
            validUntil: promo.validUntil,
            sourceUrl: promo.sourceUrl,
            appliesToAllBranches: true,
          },
        }),
      ),
    ]);

    this.logger.log(
      `${scraper.bankName}: ${scraped.length} scrapeadas, ${toPersist.length} guardadas ` +
        `(${autoCreatedChains} cadenas nuevas), ${skippedUnmatchedChain} sin cadena conocida`,
    );

    return {
      bankName: scraper.bankName,
      scraped: scraped.length,
      persisted: toPersist.length,
      autoCreatedChains,
      skippedUnmatchedChain,
    };
  }
}
