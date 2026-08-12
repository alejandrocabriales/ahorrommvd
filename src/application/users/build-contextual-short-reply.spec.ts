import { PaymentType } from '../../../generated/prisma/client';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { ConversationContext } from '../../domain/users/conversation-context';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { buildContextualShortReply } from './build-contextual-short-reply';

function intent(overrides: Partial<ParsedIntent>): ParsedIntent {
  return {
    merchantName: null,
    branchHint: null,
    categoryName: null,
    zone: null,
    amount: null,
    banks: null,
    showAllBanks: false,
    wantsGeneralSavings: false,
    confirmsRecommendation: false,
    prefersToWait: false,
    asksLocation: false,
    ...overrides,
  };
}

function context(recommendation: Recommendation): ConversationContext {
  return {
    query: {
      merchantName: null,
      branchHint: null,
      categoryName: 'Farmacias',
      zone: null,
      amount: null,
      wantsGeneralSavings: false,
    },
    recommendation,
    updatedAt: new Date().toISOString(),
  };
}

const BEST_TODAY: Recommendation['bestToday'] = {
  merchantChainName: 'Farmashop',
  branchName: null,
  neighborhood: null,
  address: null,
  bankName: 'Itaú',
  discountPercentage: 15,
  paymentType: PaymentType.CREDITO,
  cardName: null,
};

const BETTER_SOON: Recommendation['betterSoon'] = {
  option: {
    merchantChainName: "McDonald's",
    branchName: null,
    neighborhood: null,
    address: null,
    bankName: 'OCA',
    discountPercentage: 30,
    paymentType: PaymentType.CREDITO,
    cardName: null,
  },
  daysFromNow: 2,
  estimatedSaving: null,
};

const BETTER_SOON_WITH_SAVING: Recommendation['betterSoon'] = {
  ...BETTER_SOON!,
  estimatedSaving: { amount: 1200, cappedByBank: false },
};

const BASE: Recommendation = {
  queryLabel: 'Farmacias',
  zone: null,
  bestToday: null,
  alternatives: [],
  betterSoon: null,
  estimatedSavingToday: null,
  nothingFound: false,
  spentAmount: null,
  asksLocation: false,
};

describe('buildContextualShortReply', () => {
  it('confirms with bank + place + % when confirmsRecommendation and bestToday exist', () => {
    const reply = buildContextualShortReply(
      intent({ confirmsRecommendation: true }),
      context({ ...BASE, bestToday: BEST_TODAY }),
    );
    expect(reply).toContain('Itaú');
    expect(reply).toContain('Farmashop');
    expect(reply).toContain('15%');
  });

  it('adds the $ saving when estimatedSavingToday is known', () => {
    const reply = buildContextualShortReply(
      intent({ confirmsRecommendation: true }),
      context({
        ...BASE,
        bestToday: BEST_TODAY,
        estimatedSavingToday: { amount: 90, cappedByBank: false },
      }),
    );
    expect(reply).toContain('$90');
  });

  it('flags the cap explicitly when estimatedSavingToday hit the tope (§13)', () => {
    const reply = buildContextualShortReply(
      intent({ confirmsRecommendation: true }),
      context({
        ...BASE,
        bestToday: BEST_TODAY,
        estimatedSavingToday: { amount: 800, cappedByBank: true },
      }),
    );
    expect(reply).toContain('$800');
    expect(reply).toContain('tope');
  });

  it('returns null on confirmsRecommendation when there is nothing to confirm', () => {
    const reply = buildContextualShortReply(
      intent({ confirmsRecommendation: true }),
      context(BASE),
    );
    expect(reply).toBeNull();
  });

  it('confirms waiting with the future option and days when prefersToWait and betterSoon exist', () => {
    const reply = buildContextualShortReply(
      intent({ prefersToWait: true }),
      context({ ...BASE, betterSoon: BETTER_SOON }),
    );
    expect(reply).toContain('en 2 días');
    expect(reply).toContain("McDonald's");
    expect(reply).toContain('OCA');
    expect(reply).toContain('30%');
  });

  it('compares $ directly instead of offering to calculate when estimatedSaving is already known (§6)', () => {
    const reply = buildContextualShortReply(
      intent({ prefersToWait: true }),
      context({ ...BASE, betterSoon: BETTER_SOON_WITH_SAVING }),
    );
    expect(reply).toContain('$1200');
    expect(reply).not.toContain('Avisame cuando quieras que te calcule');
  });

  it('returns null on prefersToWait when there is no known future improvement', () => {
    const reply = buildContextualShortReply(
      intent({ prefersToWait: true }),
      context(BASE),
    );
    expect(reply).toBeNull();
  });

  it('returns null when neither flag is set', () => {
    const reply = buildContextualShortReply(
      intent({}),
      context({ ...BASE, bestToday: BEST_TODAY }),
    );
    expect(reply).toBeNull();
  });
});
