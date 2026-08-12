import { PaymentType } from '../../../generated/prisma/client';
import { addDays, endOfDay, startOfDay } from './compute-promotion-comparison';
import { BrowseByCategoryUseCase } from './browse-by-category.use-case';

interface FakePromoRow {
  merchantChainId: string;
  merchantChain: { name: string };
  bank: { name: string };
  discountPercentage: number;
  paymentType: PaymentType;
  cardName: string | null;
  capAmount: number | null;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string;
}

function row(
  overrides: Partial<FakePromoRow> & {
    merchantChainId: string;
    merchantChainName: string;
  },
): FakePromoRow {
  const today = new Date();
  return {
    bank: { name: 'Itaú' },
    discountPercentage: 10,
    paymentType: PaymentType.CREDITO,
    cardName: null,
    capAmount: null,
    validFrom: startOfDay(today),
    validUntil: endOfDay(today),
    sourceUrl: 'https://example.com',
    ...overrides,
    merchantChain: { name: overrides.merchantChainName },
  };
}

function buildPrisma(rows: FakePromoRow[]) {
  return { promotion: { findMany: jest.fn().mockResolvedValue(rows) } };
}

describe('BrowseByCategoryUseCase', () => {
  it('picks the highest % active today as bestToday, and up to 3 others as alternatives', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 25,
        bank: { name: 'Itaú' },
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
        bank: { name: 'Santander' },
      }),
      row({
        merchantChainId: 'c3',
        merchantChainName: 'Vidal',
        discountPercentage: 10,
        bank: { name: 'OCA' },
      }),
      row({
        merchantChainId: 'c4',
        merchantChainName: 'Nix',
        discountPercentage: 5,
        bank: { name: 'Itaú' },
      }),
      row({
        merchantChainId: 'c5',
        merchantChainName: 'Sarandí',
        discountPercentage: 2,
        bank: { name: 'Itaú' },
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday).toMatchObject({
      merchantChainName: 'Farmashop',
      bankName: 'Itaú',
      discountPercentage: 25,
    });
    expect(rec.alternatives).toHaveLength(3);
    expect(rec.alternatives.map((a) => a.merchantChainName)).toEqual([
      'San Roque',
      'Vidal',
      'Nix', // Sarandí (2%) queda afuera, solo entran las 3 mejores
    ]);
    expect(rec.nothingFound).toBe(false);
  });

  it('keeps only the best promo per chain (no duplicate chain in bestToday/alternatives)', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 10,
      }),
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 25,
      }), // mismo chain, mejor %
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday?.discountPercentage).toBe(25);
    expect(rec.alternatives).toEqual([
      expect.objectContaining({ merchantChainName: 'San Roque' }),
    ]);
  });

  it('sets betterSoon when a future day beats today, with the right daysFromNow', async () => {
    const today = new Date();
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 40,
        validFrom: startOfDay(addDays(today, 2)),
        validUntil: endOfDay(addDays(today, 2)),
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday?.discountPercentage).toBe(15);
    expect(rec.betterSoon).toMatchObject({
      daysFromNow: 2,
      option: expect.objectContaining({
        merchantChainName: 'San Roque',
        discountPercentage: 40,
      }),
    });
  });

  it('leaves betterSoon null when nothing upcoming beats today (no false "conviene esperar")', async () => {
    const today = new Date();
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 40,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
        validFrom: startOfDay(addDays(today, 1)),
        validUntil: endOfDay(addDays(today, 1)),
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.betterSoon).toBeNull();
  });

  it('marks nothingFound when there are no promotions at all in the window', async () => {
    const prisma = buildPrisma([]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.nothingFound).toBe(true);
    expect(rec.bestToday).toBeNull();
    expect(rec.alternatives).toEqual([]);
  });

  it('searches across all categories when categoryName is null (ej. "quiero ahorrar hoy")', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'Ta-Ta',
        discountPercentage: 20,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute(null, null, undefined);

    expect(prisma.promotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          merchantChain: expect.anything(),
        }),
      }),
    );
    expect(rec.bestToday).toMatchObject({
      merchantChainName: 'Ta-Ta',
      discountPercentage: 20,
    });
    expect(rec.queryLabel).toBe('lo mejor de hoy en Montevideo');
  });

  it('computes estimatedSavingToday against bestToday when an amount comes from a follow-up message', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
        bank: { name: 'Itaú' },
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined, 600);

    expect(rec.estimatedSavingToday).toEqual({
      amount: 90,
      cappedByBank: false,
    });
    expect(rec.spentAmount).toBe(600);
  });

  it('leaves estimatedSavingToday/spentAmount null when no amount was given', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.estimatedSavingToday).toBeNull();
    expect(rec.spentAmount).toBeNull();
  });

  it('passes the query label and zone through untouched (zone is informational, never a proximity filter)', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 10,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(prisma as never);

    const rec = await useCase.execute('Farmacias', 'Pocitos', undefined);

    expect(rec.queryLabel).toBe('Farmacias');
    expect(rec.zone).toBe('Pocitos');
    // Sin datos reales de sucursal, nunca inventamos "neighborhood".
    expect(rec.bestToday?.neighborhood).toBeNull();
  });
});
