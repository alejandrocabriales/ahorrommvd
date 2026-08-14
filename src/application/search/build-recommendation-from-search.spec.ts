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
      address: null,
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
      option: expect.objectContaining({
        bankName: 'OCA',
        discountPercentage: 40,
      }),
      daysFromNow: 1,
      estimatedSaving: null,
    });
  });

  it('computes estimatedSaving for betterSoon too, so $ hoy se puede comparar contra $ esperando', () => {
    const rec = buildRecommendationFromSearch(
      resolved({
        today: PROMO,
        better: {
          promotion: {
            ...PROMO,
            bankName: 'OCA',
            discountPercentage: 40,
            capAmount: 2000,
          },
          daysFromNow: 1,
        },
      }),
      null,
      4000,
    );

    expect(rec.betterSoon?.estimatedSaving).toEqual({
      amount: 1600,
      cappedByBank: false,
    });
  });

  it('respects the cap on the betterSoon estimate too', () => {
    const rec = buildRecommendationFromSearch(
      resolved({
        today: PROMO,
        better: {
          promotion: {
            ...PROMO,
            bankName: 'OCA',
            discountPercentage: 40,
            capAmount: 800,
          },
          daysFromNow: 1,
        },
      }),
      null,
      4000,
    );

    expect(rec.betterSoon?.estimatedSaving).toEqual({
      amount: 800,
      cappedByBank: true,
    });
  });

  it('only carries a $ estimate when the backend actually computed one from a real amount', () => {
    const withAmount = buildRecommendationFromSearch(
      resolved({
        today: PROMO,
        estimatedSaving: {
          amount: 800,
          discountPercentage: 20,
          cappedByBank: false,
        },
      }),
      null,
    );
    const withoutAmount = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      null,
    );

    expect(withAmount.estimatedSavingToday).toEqual({
      amount: 800,
      cappedByBank: false,
    });
    expect(withoutAmount.estimatedSavingToday).toBeNull();
  });

  it('marks nothingFound only when both today and better are absent', () => {
    expect(buildRecommendationFromSearch(resolved({}), null).nothingFound).toBe(
      true,
    );
    expect(
      buildRecommendationFromSearch(resolved({ today: PROMO }), null)
        .nothingFound,
    ).toBe(false);
  });

  it('carries the spent amount through when a follow-up message provided one', () => {
    const withAmount = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      null,
      600,
    );
    const withoutAmount = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      null,
    );

    expect(withAmount.spentAmount).toBe(600);
    expect(withoutAmount.spentAmount).toBeNull();
  });

  it('passes the zone through as informational context, without touching bestToday', () => {
    const rec = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      'Pocitos',
    );
    expect(rec.zone).toBe('Pocitos');
    expect(rec.bestToday?.neighborhood).toBeNull();
  });

  it('carries the resolved address/neighborhood through to bestToday and betterSoon ("¿dónde está?")', () => {
    const rec = buildRecommendationFromSearch(
      resolved({
        today: PROMO,
        better: { promotion: PROMO, daysFromNow: 1 },
        neighborhood: 'Pocitos',
        address: 'Av. Brasil 2846',
      }),
      null,
    );

    expect(rec.bestToday?.address).toBe('Av. Brasil 2846');
    expect(rec.bestToday?.neighborhood).toBe('Pocitos');
    expect(rec.betterSoon?.option.address).toBe('Av. Brasil 2846');
  });

  it('leaves address null (never invents one) when we never resolved a specific branch', () => {
    const rec = buildRecommendationFromSearch(resolved({ today: PROMO }), null);
    expect(rec.bestToday?.address).toBeNull();
  });

  it('threads asksLocation through, defaulting to false', () => {
    const withoutFlag = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      null,
    );
    const withFlag = buildRecommendationFromSearch(
      resolved({ today: PROMO }),
      null,
      null,
      true,
    );

    expect(withoutFlag.asksLocation).toBe(false);
    expect(withFlag.asksLocation).toBe(true);
  });
});
