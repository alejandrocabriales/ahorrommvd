import { PaymentType } from '../../../generated/prisma/client';
import { PromotionSummary } from '../../domain/search/search-result';
import { computePromotionComparison } from './compute-promotion-comparison';

const TODAY = new Date(2026, 7, 11); // martes, para que coincida con el ejemplo del spec

function summary(overrides: Partial<PromotionSummary>): PromotionSummary {
  return {
    bankName: 'Santander',
    discountPercentage: 20,
    paymentType: PaymentType.CREDITO,
    cardName: null,
    capAmount: null,
    validFrom: TODAY,
    validUntil: TODAY,
    sourceUrl: 'https://example.com',
    ...overrides,
  };
}

function daysFrom(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

describe('computePromotionComparison', () => {
  it('matches the spec example: Santander 20% today, OCA 40% tomorrow -> better points to tomorrow', () => {
    const today = summary({ bankName: 'Santander', discountPercentage: 20 });
    const tomorrow = summary({
      bankName: 'OCA',
      discountPercentage: 40,
      validFrom: daysFrom(TODAY, 1),
      validUntil: daysFrom(TODAY, 1),
    });

    const result = computePromotionComparison([today, tomorrow], TODAY);

    expect(result.today?.bankName).toBe('Santander');
    expect(result.better).toMatchObject({
      daysFromNow: 1,
      promotion: { bankName: 'OCA', discountPercentage: 40 },
    });
  });

  it('does not suggest waiting when nothing upcoming beats today', () => {
    const today = summary({ discountPercentage: 40 });
    const worseNextWeek = summary({
      discountPercentage: 15,
      validFrom: daysFrom(TODAY, 3),
      validUntil: daysFrom(TODAY, 3),
    });

    const result = computePromotionComparison([today, worseNextWeek], TODAY);

    expect(result.today?.discountPercentage).toBe(40);
    expect(result.better).toBeNull();
  });

  it('picks the soonest day among equally-good upcoming promotions', () => {
    const day2 = summary({
      discountPercentage: 30,
      validFrom: daysFrom(TODAY, 2),
      validUntil: daysFrom(TODAY, 2),
    });
    const day5 = summary({
      discountPercentage: 30,
      validFrom: daysFrom(TODAY, 5),
      validUntil: daysFrom(TODAY, 5),
    });

    const result = computePromotionComparison([day2, day5], TODAY);

    expect(result.better?.daysFromNow).toBe(2);
  });

  it('returns today: null and a better recommendation when there is nothing active today but something later', () => {
    const nextWeek = summary({
      discountPercentage: 25,
      validFrom: daysFrom(TODAY, 4),
      validUntil: daysFrom(TODAY, 4),
    });

    const result = computePromotionComparison([nextWeek], TODAY);

    expect(result.today).toBeNull();
    expect(result.better).toMatchObject({ daysFromNow: 4 });
  });

  it('returns everything untouched in `upcoming` regardless of the today/better split', () => {
    const promos = [
      summary({}),
      summary({
        validFrom: daysFrom(TODAY, 3),
        validUntil: daysFrom(TODAY, 3),
      }),
    ];

    const result = computePromotionComparison(promos, TODAY);

    expect(result.upcoming).toHaveLength(2);
  });
});
