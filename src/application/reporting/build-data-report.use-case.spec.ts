import { PaymentType } from '../../../generated/prisma/client';
import { BankScraper } from '../../domain/scraping/bank-scraper.port';
import { ScrapedPromotion } from '../../domain/scraping/scraped-promotion';
import { BuildDataReportUseCase } from './build-data-report.use-case';
import { addDays } from '../search/compute-promotion-comparison';

const TODAY = new Date('2026-08-14T10:00:00');

interface FakeBranch {
  latitude: number | null;
  longitude: number | null;
}

interface FakePromo {
  bank: { name: string };
  validFrom: Date;
  validUntil: Date;
}

interface FakeChain {
  name: string;
  branches: FakeBranch[];
  promotions: FakePromo[];
}

function promo(bankName: string, active = true): FakePromo {
  return {
    bank: { name: bankName },
    validFrom: active ? addDays(TODAY, -1) : addDays(TODAY, -30),
    validUntil: active ? addDays(TODAY, 10) : addDays(TODAY, -10),
  };
}

const LOCATED: FakeBranch = { latitude: -34.9, longitude: -56.16 };

function prismaFor(
  categories: Array<{ name: string; merchantChains: FakeChain[] }>,
  chainRows: Array<{ id: string; name: string; categoryId: string }> = [],
) {
  return {
    category: { findMany: jest.fn().mockResolvedValue(categories) },
    merchantChain: { findMany: jest.fn().mockResolvedValue(chainRows) },
  } as never;
}

function scraperFor(
  bankName: string,
  promotions: ScrapedPromotion[] | Error,
): BankScraper {
  return {
    bankName,
    scrape: jest.fn(() =>
      promotions instanceof Error
        ? Promise.reject(promotions)
        : Promise.resolve(promotions),
    ),
  };
}

function scraped(
  merchantChainName: string,
  categoryName?: ScrapedPromotion['categoryName'],
): ScrapedPromotion {
  return {
    merchantChainName,
    categoryName,
    discountPercentage: 20,
    paymentType: PaymentType.AMBOS,
    validFrom: TODAY,
    validUntil: addDays(TODAY, 7),
    sourceUrl: 'https://banco.uy',
  };
}

describe('BuildDataReportUseCase', () => {
  it('separa promos vigentes de promos recomendables — una cadena sin sucursal geolocalizada no se le puede ofrecer a nadie', async () => {
    const prisma = prismaFor([
      {
        name: 'Restaurantes',
        merchantChains: [
          {
            name: 'Con sucursal',
            branches: [LOCATED],
            promotions: [promo('Itaú')],
          },
          { name: 'Sin sucursal', branches: [], promotions: [promo('Itaú')] },
          {
            // Sucursal cargada pero sin coordenadas: no sirve para medir
            // distancia, así que no cuenta como verificada.
            name: 'Sucursal sin coordenadas',
            branches: [{ latitude: null, longitude: null }],
            promotions: [promo('Itaú')],
          },
        ],
      },
    ]);

    const report = await new BuildDataReportUseCase(prisma).execute({
      now: TODAY,
    });

    expect(report.categories[0]).toMatchObject({
      categoryName: 'Restaurantes',
      chains: 3,
      chainsWithBranches: 1,
      branches: 1,
      activePromotions: 3,
      recommendablePromotions: 1,
    });
    expect(report.categories[0].chainsWithoutBranchesSamples).toEqual([
      'Sin sucursal',
      'Sucursal sin coordenadas',
    ]);
  });

  it('no cuenta promos vencidas', async () => {
    const prisma = prismaFor([
      {
        name: 'Farmacias',
        merchantChains: [
          {
            name: 'Farmashop',
            branches: [LOCATED],
            promotions: [promo('OCA'), promo('OCA', false)],
          },
        ],
      },
    ]);

    const report = await new BuildDataReportUseCase(prisma).execute({
      now: TODAY,
    });

    expect(report.categories[0].activePromotions).toBe(1);
    expect(report.bankCategories).toEqual([
      {
        bankName: 'OCA',
        categoryName: 'Farmacias',
        activePromotions: 1,
        recommendablePromotions: 1,
      },
    ]);
  });

  it('cruza banco × categoría — es la vista que muestra un banco sin nada recomendable en un rubro', async () => {
    const prisma = prismaFor([
      {
        name: 'Restaurantes',
        merchantChains: [
          { name: 'Soho', branches: [], promotions: [promo('Itaú')] },
          {
            name: 'Bardo',
            branches: [LOCATED],
            promotions: [promo('Santander')],
          },
        ],
      },
    ]);

    const report = await new BuildDataReportUseCase(prisma).execute({
      now: TODAY,
    });

    expect(report.bankCategories).toEqual([
      {
        bankName: 'Itaú',
        categoryName: 'Restaurantes',
        activePromotions: 1,
        recommendablePromotions: 0,
      },
      {
        bankName: 'Santander',
        categoryName: 'Restaurantes',
        activePromotions: 1,
        recommendablePromotions: 1,
      },
    ]);
  });

  it('sin includeIngestion no corre los scrapers', async () => {
    const scraper = scraperFor('Itaú', [scraped('Soho')]);
    const report = await new BuildDataReportUseCase(prismaFor([]), [
      scraper,
    ]).execute({ now: TODAY });

    expect(report.ingestion).toBeNull();
    expect(scraper.scrape).not.toHaveBeenCalled();
  });

  it('clasifica el embudo con el mismo criterio que el sync: matchea, auto-crea, o se pierde', async () => {
    const prisma = prismaFor(
      [],
      [{ id: 'c1', name: 'Ta-Ta', categoryId: 'cat' }],
    );
    const scraper = scraperFor('OCA', [
      scraped('TaTa'), // matchea la cadena existente (normalizado)
      scraped('Kentucky', 'Restaurantes'), // el sync la crearía
      scraped('Óptica Florida'), // ni cadena ni categoría -> se pierde
    ]);

    const report = await new BuildDataReportUseCase(prisma, [scraper]).execute({
      now: TODAY,
      includeIngestion: true,
    });

    expect(report.ingestion).toEqual([
      {
        bankName: 'OCA',
        scraped: 3,
        matchedExistingChain: 1,
        autoCreatableChain: 1,
        dropped: 1,
        droppedSamples: ['Óptica Florida'],
      },
    ]);
  });

  it('un scraper caído no tumba el reporte de los otros bancos', async () => {
    const prisma = prismaFor([], []);
    const report = await new BuildDataReportUseCase(prisma, [
      scraperFor('Itaú', new Error('feed 500')),
      scraperFor('Santander', [scraped('Bardo', 'Restaurantes')]),
    ]).execute({ now: TODAY, includeIngestion: true });

    expect(report.ingestion?.[0]).toMatchObject({
      bankName: 'Itaú',
      error: 'feed 500',
      scraped: 0,
    });
    expect(report.ingestion?.[1]).toMatchObject({
      bankName: 'Santander',
      scraped: 1,
      autoCreatableChain: 1,
    });
  });
});
