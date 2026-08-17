import { PaymentType } from '../../../generated/prisma/client';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { ConversationContext } from '../../domain/users/conversation-context';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { mergeWithContext } from './merge-with-context';

function intent(overrides: Partial<ParsedIntent>): ParsedIntent {
  return {
    merchantName: null,
    branchHint: null,
    need: null,
    items: [],
    zone: null,
    city: null,
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

const NOW = new Date('2026-08-12T12:00:00.000Z');

const FARMACIAS_RECOMMENDATION: Recommendation = {
  queryLabel: 'Farmacias',
  requestedItems: [],
  zone: null,
  bestToday: {
    merchantChainName: 'Farmashop',
    branchName: null,
    neighborhood: null,
    address: null,
    bankName: 'Itaú',
    discountPercentage: 15,
    paymentType: PaymentType.CREDITO,
    cardName: null,
  },
  alternatives: [],
  betterSoon: null,
  estimatedSavingToday: null,
  nothingFound: false,
  spentAmount: null,
  asksLocation: false,
  unverifiedOnly: false,
  zoneWidened: false,
  bestWithOtherBank: null,
  otherBenefits: [],
};

function contextAt(
  minutesAgo: number,
  query: ConversationContext['query'],
): ConversationContext {
  const updatedAt = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  return { query, recommendation: FARMACIAS_RECOMMENDATION, updatedAt };
}

const FARMACIAS_QUERY: ConversationContext['query'] = {
  merchantName: null,
  branchHint: null,
  need: 'pharmacy',
  items: [],
  zone: null,
  amount: null,
  wantsGeneralSavings: false,
};

const TA_TA_QUERY: ConversationContext['query'] = {
  merchantName: 'Ta-Ta',
  branchHint: null,
  need: null,
  items: [],
  zone: null,
  amount: null,
  wantsGeneralSavings: false,
};

describe('mergeWithContext', () => {
  it('returns the bare intent when there is no context at all', () => {
    const result = mergeWithContext(intent({ amount: 600 }), null, NOW);
    expect(result).toEqual({
      merchantName: null,
      branchHint: null,
      need: null,
      items: [],
      zone: null,
      amount: 600,
      wantsGeneralSavings: false,
    });
  });

  it('ignores stale context (older than 30 minutes)', () => {
    const context = contextAt(31, FARMACIAS_QUERY);
    const result = mergeWithContext(intent({ amount: 600 }), context, NOW);
    expect(result.need).toBeNull();
    expect(result.amount).toBe(600);
  });

  it('fills the category from context when a follow-up only gives an amount ("600 pesos")', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(intent({ amount: 600 }), context, NOW);
    expect(result).toEqual({
      merchantName: null,
      branchHint: null,
      need: 'pharmacy',
      items: [],
      zone: null,
      amount: 600,
      wantsGeneralSavings: false,
    });
  });

  it('retoma el tema cuando el seguimiento solo cambia las tarjetas ("y para tarjetas Itaú?")', () => {
    // Bug real (14/8): venía de preguntar dónde comer, dijo "y para
    // tarjetas Itau?" y el bot le guardó el banco pero contestó "no
    // entendí bien qué buscás" — el tema estaba en el contexto.
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(intent({ banks: ['Itaú'] }), context, NOW);
    expect(result.need).toBe('pharmacy');
  });

  it('retoma el tema con "dame todas" (mismo caso, sin filtro de banco)', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(
      intent({ showAllBanks: true }),
      context,
      NOW,
    );
    expect(result.need).toBe('pharmacy');
  });

  it('does not merge when the message opens its own topic, even with fresh context', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(
      intent({ merchantName: 'Devoto' }),
      context,
      NOW,
    );
    expect(result.merchantName).toBe('Devoto');
    expect(result.need).toBeNull();
  });

  it('treats a new neighborhood as a branch refinement when context was merchant-specific ("y en Pocitos?")', () => {
    const context = contextAt(2, TA_TA_QUERY);
    const result = mergeWithContext(intent({ zone: 'Pocitos' }), context, NOW);
    expect(result.merchantName).toBe('Ta-Ta');
    expect(result.branchHint).toBe('Pocitos');
  });

  it('treats a new neighborhood as an informational zone when context was category-based', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(intent({ zone: 'Pocitos' }), context, NOW);
    expect(result.need).toBe('pharmacy');
    expect(result.zone).toBe('Pocitos');
  });

  it('merges on a bare confirmation/wait signal too, keeping the topic from context', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(
      intent({ confirmsRecommendation: true }),
      context,
      NOW,
    );
    expect(result.need).toBe('pharmacy');
  });

  it('does not force a merge for a message with no follow-up signal at all ("hola")', () => {
    const context = contextAt(2, FARMACIAS_QUERY);
    const result = mergeWithContext(intent({}), context, NOW);
    expect(result.need).toBeNull();
  });
});
