import { PaymentType } from '../../../generated/prisma/client';
import { PromotionSummary } from '../../domain/search/search-result';
import { SearchResponse } from '../../domain/search/search-response';
import { buildRecommendationFromSearch } from './build-recommendation-from-search';

const PROMO: PromotionSummary = {
  bankName: 'Santander',
  discountPercentage: 20,
  paymentType: PaymentType.CREDITO,
  cardName: null,
  capAmount: null,
  validFrom: new Date('2020-01-01'),
  validUntil: new Date('2999-01-01'),
  sourceUrl: 'https://example.com',
};

function resolved(
  overrides: Partial<Extract<SearchResponse, { status: 'resolved' }>>,
): Extract<SearchResponse, { status: 'resolved' }> {
  return {
    status: 'resolved',
    merchantChainName: 'Ta-Ta',
    message: 'irrelevante — el Response Generator no usa este campo',
    today: null,
    better: null,
    upcoming: [],
    ...overrides,
  };
}

describe('buildRecommendationFromSearch', () => {
  it('maps today into bestToday, using the branch name as queryLabel when there is one', () => {
    const rec = buildRecommendationFromSearch(
      resolved({ branchName: 'Ta-Ta Pocitos', today: PROMO }),
      null,
    );

    expect(rec.queryLabel).toBe('Ta-Ta Pocitos');
    expect(rec.bestToday).toEqual({
      merchantChainName: 'Ta-Ta',
      branchName: 'Ta-Ta Pocitos',
      neighborhood: null,
      bankName: 'Santander',
      discountPercentage: 20,
      paymentType: PaymentType.CREDITO,
      cardName: null,
    });
    expect(rec.nothingFound).toBe(false);
  });

  it('falls back to the chain name as queryLabel when there is no specific branch', () => {
    const rec = buildRecommendationFromSearch(resolved({ today: PROMO }), null);
    expect(rec.queryLabel).toBe('Ta-Ta');
  });

  it('never fabricates alternatives — a merchant search only ever recommends what was asked', () => {
    const rec = buildRecommendationFromSearch(resolved({ today: PROMO }), null);
    expect(rec.alternatives).toEqual([]);
  });

  it('maps better into betterSoon with daysFromNow', () => {
    const rec = buildRecommendationFromSearch(
      resolved({
        today: PROMO,
        better: {
          promotion: { ...PROMO, bankName: 'OCA', discountPercentage: 40 },
          daysFromNow: 1,
        },
      }),
      null,
    );

    expect(rec.betterSoon).toEqual({
      option: expect.objectContaining({ bankName: 'OCA', discountPercentage: 40 }),
      daysFromNow: 1,
    });
  });

  it('only carries a $ estimate when the backend actually computed one from a real amount', () => {
    const withAmount = buildRecommendationFromSearch(
      resolved({ today: PROMO, estimatedSaving: { amount: 800, discountPercentage: 20, cappedByBank: false } }),
      null,
    );
    const withoutAmount = buildRecommendationFromSearch(resolved({ today: PROMO }), null);

    expect(withAmount.estimatedSavingToday).toEqual({ amount: 800, cappedByBank: false });
    expect(withoutAmount.estimatedSavingToday).toBeNull();
  });

  it('marks nothingFound only when both today and better are absent', () => {
    expect(buildRecommendationFromSearch(resolved({}), null).nothingFound).toBe(true);
    expect(buildRecommendationFromSearch(resolved({ today: PROMO }), null).nothingFound).toBe(false);
  });

  it('passes the zone through as informational context, without touching bestToday', () => {
    const rec = buildRecommendationFromSearch(resolved({ today: PROMO }), 'Pocitos');
    expect(rec.zone).toBe('Pocitos');
    expect(rec.bestToday?.neighborhood).toBeNull();
  });
});
