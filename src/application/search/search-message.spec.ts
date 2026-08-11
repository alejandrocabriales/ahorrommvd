import { PaymentType } from '../../../generated/prisma/client';
import { PromotionSummary } from '../../domain/search/search-result';
import { buildSearchMessage, computeEstimatedSaving } from './search-message';

function summary(overrides: Partial<PromotionSummary>): PromotionSummary {
  return {
    bankName: 'Santander',
    discountPercentage: 20,
    paymentType: PaymentType.CREDITO,
    cardName: null,
    capAmount: null,
    validFrom: new Date(),
    validUntil: new Date(),
    sourceUrl: 'https://example.com',
    ...overrides,
  };
}

describe('computeEstimatedSaving', () => {
  it('matches the spec example: Ta-Ta 4000 at 20% -> $800', () => {
    const result = computeEstimatedSaving(
      summary({ discountPercentage: 20 }),
      4000,
    );
    expect(result).toMatchObject({ amount: 800, cappedByBank: false });
  });

  it('respects the bank cap when the raw discount exceeds it', () => {
    const result = computeEstimatedSaving(
      summary({ discountPercentage: 20, capAmount: 500 }),
      4000,
    );
    expect(result).toMatchObject({ amount: 500, cappedByBank: true });
  });

  it('returns null when there is no promotion today', () => {
    expect(computeEstimatedSaving(null, 4000)).toBeNull();
  });

  it('returns null when no amount was given', () => {
    expect(computeEstimatedSaving(summary({}), undefined)).toBeNull();
  });
});

describe('buildSearchMessage', () => {
  it('renders the spec example: today Santander 20%, better tomorrow OCA 40%', () => {
    const message = buildSearchMessage({
      merchantChainName: 'Ta-Ta',
      branchName: 'Ta-Ta Pocitos',
      comparison: {
        today: summary({ bankName: 'Santander', discountPercentage: 20 }),
        better: {
          promotion: summary({ bankName: 'OCA', discountPercentage: 40 }),
          daysFromNow: 1,
        },
        upcoming: [],
      },
      estimatedSaving: {
        amount: 800,
        discountPercentage: 20,
        cappedByBank: false,
      },
    });

    expect(message).toContain(
      'Hoy podés ahorrar 20% con Santander (aproximadamente $800)',
    );
    expect(message).toContain('Pero mañana Ta-Ta Pocitos tiene 40% con OCA');
  });

  it('says nothing found when there is no promotion at all', () => {
    const message = buildSearchMessage({
      merchantChainName: 'Nona',
      comparison: { today: null, better: null, upcoming: [] },
    });

    expect(message).toBe(
      'No encontré promociones vigentes para Nona en los próximos 7 días.',
    );
  });
});
