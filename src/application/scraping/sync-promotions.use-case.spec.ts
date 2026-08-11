import { PaymentType } from '../../../generated/prisma/client';
import { BankScraper } from '../../domain/scraping/bank-scraper.port';
import { ScrapedPromotion } from '../../domain/scraping/scraped-promotion';
import { SyncPromotionsUseCase } from './sync-promotions.use-case';

const FARMASHOP_CHAIN = {
  id: 'chain-farmashop',
  name: 'Farmashop',
  categoryId: 'cat-farmacias',
};
const CATEGORIES = [
  { id: 'cat-super', name: 'Supermercados' },
  { id: 'cat-farmacias', name: 'Farmacias' },
  { id: 'cat-resto', name: 'Restaurantes' },
];

function promo(
  overrides: Partial<ScrapedPromotion> & { merchantChainName: string },
): ScrapedPromotion {
  return {
    discountPercentage: 10,
    paymentType: PaymentType.AMBOS,
    validFrom: new Date(2026, 0, 1),
    validUntil: new Date(2026, 0, 31),
    sourceUrl: 'https://example.com',
    ...overrides,
  };
}

function fakeScraper(
  bankName: string,
  promos: ScrapedPromotion[],
): BankScraper {
  return { bankName, scrape: () => Promise.resolve(promos) };
}

function buildPrismaMock() {
  let nextChainId = 1;
  const upsertedChains: Array<{ name: string; categoryId: string }> = [];

  return {
    upsertedChains,
    merchantChain: {
      findMany: jest.fn().mockResolvedValue([FARMASHOP_CHAIN]),
      upsert: jest
        .fn()
        .mockImplementation(
          ({ create }: { create: { name: string; categoryId: string } }) => {
            upsertedChains.push(create);
            return Promise.resolve({
              id: `chain-auto-${nextChainId++}`,
              ...create,
            });
          },
        ),
    },
    category: { findMany: jest.fn().mockResolvedValue(CATEGORIES) },
    bank: {
      findUnique: jest
        .fn()
        .mockImplementation(
          ({ where: { name } }: { where: { name: string } }) =>
            Promise.resolve({ id: `bank-${name}`, name }),
        ),
    },
    promotion: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('SyncPromotionsUseCase', () => {
  it('matches an existing chain by name without creating a new one', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SyncPromotionsUseCase(prisma as never, [
      fakeScraper('Santander', [promo({ merchantChainName: 'farmashop' })]),
    ]);

    const [result] = await useCase.execute();

    expect(result.persisted).toBe(1);
    expect(result.autoCreatedChains).toBe(0);
    expect(prisma.merchantChain.upsert).not.toHaveBeenCalled();
  });

  it('auto-creates a chain when the scraper gives a trustworthy category, and reuses it for repeats in the same run', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SyncPromotionsUseCase(prisma as never, [
      fakeScraper('Santander', [
        promo({ merchantChainName: 'Nona', categoryName: 'Restaurantes' }),
        promo({
          merchantChainName: 'Nona',
          categoryName: 'Restaurantes',
          sourceUrl: 'https://example.com/2',
        }),
      ]),
    ]);

    const [result] = await useCase.execute();

    expect(result.persisted).toBe(2);
    expect(result.autoCreatedChains).toBe(1);
    expect(prisma.merchantChain.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.upsertedChains).toEqual([
      { name: 'Nona', categoryId: 'cat-resto' },
    ]);
  });

  it('skips a merchant with no existing match and no category instead of guessing', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SyncPromotionsUseCase(prisma as never, [
      fakeScraper('OCA', [promo({ merchantChainName: 'Óptica Florida' })]),
    ]);

    const [result] = await useCase.execute();

    expect(result.persisted).toBe(0);
    expect(result.skippedUnmatchedChain).toBe(1);
    expect(prisma.merchantChain.upsert).not.toHaveBeenCalled();
  });
});
