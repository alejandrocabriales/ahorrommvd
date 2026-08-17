import { Inject, Injectable, Logger } from '@nestjs/common';
import { MerchantChain } from '../../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  BANK_SCRAPERS,
  BankScraper,
} from '../../domain/scraping/bank-scraper.port';
import { ScrapedBranch } from '../../domain/scraping/scraped-promotion';
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
      // Una promo sin % y sin texto de beneficio no le dice nada al usuario
      // — no la guardamos aunque el scraper la haya dejado pasar.
      if (promo.discountPercentage === undefined && !promo.benefitLabel) {
        continue;
      }

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
      await this.saveBankBranches(chain.id, promo.branches);
    }

    // createMany en vez de un create() por fila: con las ~130 promos reales
    // que puede traer Santander, N creates individuales dentro de la misma
    // transacción se pasaban del timeout default de Prisma (5s) apenas la
    // latencia de red subía un poco (ej. corriendo el sync contra la DB por
    // el proxy público en vez de la red interna de Railway). Una sola query
    // de inserción es más rápida y no escala con la cantidad de filas.
    await this.prisma.$transaction(
      [
        this.prisma.promotion.deleteMany({ where: { bankId: bank.id } }),
        this.prisma.promotion.createMany({
          data: toPersist.map((promo) => ({
            bankId: bank.id,
            merchantChainId: promo.merchantChainId,
            discountPercentage: promo.discountPercentage ?? null,
            benefitLabel: promo.benefitLabel ?? null,
            paymentType: promo.paymentType,
            cardName: promo.cardName,
            capAmount: promo.capAmount,
            validFrom: promo.validFrom,
            validUntil: promo.validUntil,
            sourceUrl: promo.sourceUrl,
            appliesToAllBranches: true,
          })),
        }),
      ],
      { timeout: 20000 },
    );

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

  /**
   * Locales que publica el propio banco junto a la promo (hoy solo Itaú).
   * Se guardan fuera del delete+create de promociones porque una sucursal no
   * es la foto de hoy: sobrevive a la promo y puede estar referenciada por un
   * ahorro registrado.
   *
   * El update solo pisa la dirección cuando el banco la publica (Santander
   * la trae en la ficha del comercio; el feed de Itaú no): si no la trae, la
   * que ya está —del backfill de Places— es mejor que nada.
   */
  private async saveBankBranches(
    merchantChainId: string,
    branches: ScrapedBranch[] | undefined,
  ): Promise<void> {
    for (const branch of branches ?? []) {
      await this.prisma.branch.upsert({
        where: {
          merchantChainId_name: { merchantChainId, name: branch.name },
        },
        create: {
          merchantChainId,
          name: branch.name,
          address: branch.address ?? null,
          latitude: branch.latitude,
          longitude: branch.longitude,
        },
        update: {
          latitude: branch.latitude,
          longitude: branch.longitude,
          ...(branch.address ? { address: branch.address } : {}),
        },
      });
    }
  }
}
