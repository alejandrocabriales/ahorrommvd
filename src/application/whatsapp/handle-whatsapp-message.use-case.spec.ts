import { PaymentType } from '../../../generated/prisma/client';
import { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { ResponseGenerator } from '../../domain/ai/response-generator.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { PendingQuery } from '../../domain/users/pending-query';
import { SearchResponse } from '../../domain/search/search-response';
import { PromotionSummary } from '../../domain/search/search-result';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { RegisterSavingUseCase } from '../savings/register-saving.use-case';
import { BrowseByCategoryUseCase } from '../search/browse-by-category.use-case';
import { SearchUseCase } from '../search/search.use-case';
import {
  ResolvedUser,
  ResolveUserUseCase,
} from '../users/resolve-user.use-case';
import { SetUserBanksUseCase } from '../users/set-user-banks.use-case';
import { SavePendingQueryUseCase } from '../users/save-pending-query.use-case';
import { ClearPendingQueryUseCase } from '../users/clear-pending-query.use-case';
import { SaveConversationContextUseCase } from '../users/save-conversation-context.use-case';
import { ConversationContext } from '../../domain/users/conversation-context';
import { HandleWhatsAppMessageUseCase } from './handle-whatsapp-message.use-case';

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
    unsupportedCategory: false,
    ...overrides,
  };
}

const KNOWN_USER: ResolvedUser = {
  id: 'user-1',
  bankNames: ['Itaú'],
  pendingQuery: null,
  conversationContext: null,
  knownZone: null,
};
const UNKNOWN_USER: ResolvedUser | null = null;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const TODAY_PROMO: PromotionSummary = {
  bankName: 'Santander',
  discountPercentage: 20,
  paymentType: PaymentType.CREDITO,
  cardName: null,
  capAmount: null,
  validFrom: new Date('2020-01-01'),
  validUntil: new Date('2999-01-01'),
  sourceUrl: 'https://example.com',
};

const DEFAULT_RECOMMENDATION: Recommendation = {
  queryLabel: 'Farmacias',
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
};

const DEFAULT_AI_REPLY = 'La mejor opción es Farmashop con Itaú, 15%.';

describe('HandleWhatsAppMessageUseCase', () => {
  // Por default el usuario YA tiene bancos conocidos, así los tests de
  // contenido no se pisan con la pregunta de "qué tarjetas tenés" — ese
  // comportamiento se prueba aparte, explícito, más abajo.
  function build(
    parsedIntent: ParsedIntent,
    searchResult?: SearchResponse,
    resolvedUser: ResolvedUser | null = KNOWN_USER,
  ) {
    const interpreter: MessageInterpreter = {
      interpret: jest.fn().mockResolvedValue(parsedIntent),
    };
    const responseGenerator: ResponseGenerator = {
      generate: jest.fn().mockResolvedValue(DEFAULT_AI_REPLY),
    };
    const searchUseCase = {
      execute: jest.fn().mockResolvedValue(searchResult),
    } as unknown as SearchUseCase;
    const browseByCategory = {
      execute: jest.fn().mockResolvedValue(DEFAULT_RECOMMENDATION),
    } as unknown as BrowseByCategoryUseCase;
    const registerSaving = {
      execute: jest.fn().mockResolvedValue({
        estimatedSaving: 800,
        totalThisMonth: 2350,
        message:
          'Registrado. Ahorraste aproximadamente $800. Total registrado este mes: $2350.',
      }),
    } as unknown as RegisterSavingUseCase;
    const resolveUser = {
      execute: jest.fn().mockResolvedValue(resolvedUser),
    } as unknown as ResolveUserUseCase;
    const setUserBanks = {
      execute: jest.fn().mockResolvedValue({
        userId: 'user-1',
        bankNames: ['Itaú', 'Santander'],
      }),
    } as unknown as SetUserBanksUseCase;
    const savePendingQuery = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as SavePendingQueryUseCase;
    const clearPendingQuery = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as ClearPendingQueryUseCase;
    const saveConversationContext = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as SaveConversationContextUseCase;
    const sender = {
      sendTextMessage: jest.fn(),
    } as unknown as WhatsAppSenderService;

    const useCase = new HandleWhatsAppMessageUseCase(
      interpreter,
      responseGenerator,
      searchUseCase,
      browseByCategory,
      registerSaving,
      resolveUser,
      setUserBanks,
      savePendingQuery,
      clearPendingQuery,
      saveConversationContext,
      sender,
    );
    return {
      useCase,
      interpreter,
      responseGenerator,
      searchUseCase,
      browseByCategory,
      registerSaving,
      resolveUser,
      setUserBanks,
      savePendingQuery,
      clearPendingQuery,
      saveConversationContext,
      sender,
    };
  }

  it('builds a q from merchantName+branchHint, passes userId through, and sends the AI-generated recommendation', async () => {
    const { useCase, searchUseCase, responseGenerator, sender } = build(
      intent({ merchantName: 'Ta-Ta', branchHint: 'Pocitos', amount: 4000 }),
      {
        status: 'resolved',
        merchantChainName: 'Ta-Ta',
        branchName: 'Ta-Ta Pocitos',
        message: 'Hoy podés ahorrar 20%.',
        today: TODAY_PROMO,
        better: null,
        upcoming: [TODAY_PROMO],
      },
    );

    await useCase.execute('59891234567', 'Ta-Ta Pocitos 4000');

    expect(searchUseCase.execute).toHaveBeenCalledWith({
      q: 'Ta-Ta Pocitos',
      userId: 'user-1',
      amount: 4000,
    });
    expect(responseGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryLabel: 'Ta-Ta Pocitos',
        bestToday: expect.objectContaining({ bankName: 'Santander' }),
      }),
    );
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '59891234567',
      DEFAULT_AI_REPLY,
    );
  });

  it('registers the spend and appends the confirmation after the AI recommendation', async () => {
    const { useCase, registerSaving, sender } = build(
      intent({ merchantName: 'Ta-Ta', amount: 4000 }),
      {
        status: 'resolved',
        merchantChainName: 'Ta-Ta',
        branchId: 'branch-pocitos',
        branchName: 'Ta-Ta Pocitos',
        message: 'Hoy podés ahorrar 20%.',
        today: TODAY_PROMO,
        better: null,
        upcoming: [TODAY_PROMO],
      },
    );

    await useCase.execute('598', 'Ta-Ta 4000');

    expect(registerSaving.execute).toHaveBeenCalledWith(
      '598',
      'branch-pocitos',
      4000,
    );
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      `${DEFAULT_AI_REPLY}\n\nRegistrado. Ahorraste aproximadamente $800. Total registrado este mes: $2350.`,
    );
  });

  it('skips the AI call and does not register a spend when there is nothing to recommend', async () => {
    const { useCase, registerSaving, responseGenerator, sender } = build(
      intent({ merchantName: 'Bardo', amount: 500 }),
      {
        status: 'resolved',
        merchantChainName: 'Bardo',
        message: 'irrelevante',
        today: null,
        better: null,
        upcoming: [],
      },
    );

    await useCase.execute('598', 'Bardo 500');

    expect(responseGenerator.generate).not.toHaveBeenCalled();
    expect(registerSaving.execute).not.toHaveBeenCalled();
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      'No encontré promociones vigentes para Bardo en los próximos 7 días.',
    );
  });

  it('asks which branch when the search engine needs to disambiguate', async () => {
    const { useCase, sender } = build(intent({ merchantName: 'Ta-Ta' }), {
      status: 'disambiguate',
      merchantChainName: 'Ta-Ta',
      options: [
        {
          branchId: 'b1',
          branchName: 'Ta-Ta Pocitos',
          neighborhood: 'Pocitos',
        },
        { branchId: 'b2', branchName: 'Ta-Ta Cerro', neighborhood: 'Cerro' },
      ],
    });

    await useCase.execute('598', 'Ta-Ta');

    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      '¿En cuál Ta-Ta?\n- Ta-Ta Pocitos (Pocitos)\n- Ta-Ta Cerro (Cerro)',
    );
  });

  it('includes the address in the disambiguation list when we have one loaded', async () => {
    const { useCase, sender } = build(intent({ merchantName: 'Ta-Ta' }), {
      status: 'disambiguate',
      merchantChainName: 'Ta-Ta',
      options: [
        {
          branchId: 'b1',
          branchName: 'Ta-Ta Pocitos',
          neighborhood: 'Pocitos',
          address: 'Av. Brasil 2846',
        },
        {
          branchId: 'b2',
          branchName: 'Ta-Ta Cerro',
          neighborhood: 'Cerro',
          address: null,
        },
      ],
    });

    await useCase.execute('598', 'Ta-Ta');

    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      '¿En cuál Ta-Ta?\n- Ta-Ta Pocitos (Pocitos) — Av. Brasil 2846\n- Ta-Ta Cerro (Cerro)',
    );
  });

  describe('"¿dónde está?" (§ producción: "Chajá donde esta?")', () => {
    it('threads asksLocation through to the Recommendation so the Response Generator can prioritize the address', async () => {
      const { useCase, responseGenerator } = build(
        intent({ merchantName: 'Chajá', asksLocation: true }),
        {
          status: 'resolved',
          merchantChainName: 'Chajá',
          branchName: 'Chajá Pocitos',
          neighborhood: 'Pocitos',
          address: 'Bulevar España 2411',
          message: 'irrelevante',
          today: TODAY_PROMO,
          better: null,
          upcoming: [TODAY_PROMO],
        },
      );

      await useCase.execute('598', 'Chajá donde esta?');

      expect(responseGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          asksLocation: true,
          bestToday: expect.objectContaining({ address: 'Bulevar España 2411' }),
        }),
      );
    });

    it('leaves address null (honest gap, never invented) when we never loaded one for that branch', async () => {
      const { useCase, responseGenerator } = build(
        intent({ merchantName: 'Chajá', asksLocation: true }),
        {
          status: 'resolved',
          merchantChainName: 'Chajá',
          message: 'irrelevante',
          today: TODAY_PROMO,
          better: null,
          upcoming: [TODAY_PROMO],
        },
      );

      await useCase.execute('598', 'Chajá donde esta?');

      expect(responseGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          asksLocation: true,
          bestToday: expect.objectContaining({ address: null }),
        }),
      );
    });
  });

  it('sends a not-found message when the engine could not resolve the merchant', async () => {
    const { useCase, sender } = build(intent({ merchantName: 'Nonexistent' }), {
      status: 'not_found',
    });

    await useCase.execute('598', 'Nonexistent');

    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      expect.stringContaining('No encontré'),
    );
  });

  it('browses by category (passing zone+userId through) and sends the AI-generated recommendation', async () => {
    const { useCase, browseByCategory, sender } = build(
      intent({ categoryName: 'Farmacias' }),
    );

    await useCase.execute('598', 'necesito una farmacia');

    expect(browseByCategory.execute).toHaveBeenCalledWith(
      'Farmacias',
      null,
      'user-1',
      undefined,
    );
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      DEFAULT_AI_REPLY,
    );
  });

  it('threads the mentioned zone through to category browsing', async () => {
    const { useCase, browseByCategory } = build(
      intent({ categoryName: 'Restaurantes', zone: 'Barrio Sur' }),
    );

    await useCase.execute('598', 'quiero comer algo en barrio sur');

    expect(browseByCategory.execute).toHaveBeenCalledWith(
      'Restaurantes',
      'Barrio Sur',
      'user-1',
      undefined,
    );
  });

  it('browses across all 3 MVP categories when the user wants general savings with no merchant/category (ej. "quiero ahorrar hoy")', async () => {
    const { useCase, browseByCategory, sender } = build(
      intent({ wantsGeneralSavings: true }),
    );

    await useCase.execute('598', 'quiero ahorrar hoy');

    expect(browseByCategory.execute).toHaveBeenCalledWith(
      null,
      null,
      'user-1',
      undefined,
    );
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      DEFAULT_AI_REPLY,
    );
  });

  it('asks for clarification when nothing could be extracted from the message', async () => {
    const { useCase, sender } = build(intent({}));

    await useCase.execute('598', 'hola');

    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      expect.stringContaining('No entendí'),
    );
  });

  describe('bancos del usuario', () => {
    it('saves the mentioned banks and prepends a confirmation to the AI reply', async () => {
      const { useCase, setUserBanks, sender } = build(
        intent({ merchantName: 'Ta-Ta', banks: ['Itaú', 'Santander'] }),
        {
          status: 'resolved',
          merchantChainName: 'Ta-Ta',
          message: 'irrelevante',
          today: TODAY_PROMO,
          better: null,
          upcoming: [TODAY_PROMO],
        },
      );

      await useCase.execute('598', 'tengo Itaú y Santander, Ta-Ta');

      expect(setUserBanks.execute).toHaveBeenCalledWith('598', [
        'Itaú',
        'Santander',
      ]);
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        `Listo, guardé que tenés tarjetas de Itaú, Santander.\n\n${DEFAULT_AI_REPLY}`,
      );
    });

    it('bypasses the bank filter for this reply when the user asks for all offers, even with known banks', async () => {
      const { useCase, searchUseCase, sender } = build(
        intent({ merchantName: 'Ta-Ta', showAllBanks: true }),
        {
          status: 'resolved',
          merchantChainName: 'Ta-Ta',
          message: 'irrelevante',
          today: TODAY_PROMO,
          better: null,
          upcoming: [TODAY_PROMO],
        },
        KNOWN_USER, // ya sabemos que tiene Itaú
      );

      await useCase.execute('598', 'dame todas las ofertas de Ta-Ta');

      expect(searchUseCase.execute).toHaveBeenCalledWith({
        q: 'Ta-Ta',
        userId: undefined,
        amount: undefined,
      });
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        DEFAULT_AI_REPLY,
      );
    });

    it('bypasses the filter for category browsing too, and does not touch saved banks', async () => {
      const { useCase, browseByCategory, setUserBanks } = build(
        intent({ categoryName: 'Farmacias', showAllBanks: true }),
        undefined,
        KNOWN_USER,
      );

      await useCase.execute('598', 'mostrame todas las ofertas de farmacias');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        null,
        undefined,
        undefined,
      );
      expect(setUserBanks.execute).not.toHaveBeenCalled();
    });
  });

  describe('pregunta las tarjetas antes de contestar (usuario desconocido)', () => {
    it('asks which banks instead of answering, and saves the query as pending', async () => {
      const { useCase, searchUseCase, savePendingQuery, sender } = build(
        intent({ merchantName: 'Ta-Ta', branchHint: 'Pocitos' }),
        undefined,
        UNKNOWN_USER,
      );

      await useCase.execute('598', 'Ta-Ta Pocitos');

      expect(searchUseCase.execute).not.toHaveBeenCalled();
      expect(savePendingQuery.execute).toHaveBeenCalledWith('598', {
        merchantName: 'Ta-Ta',
        branchHint: 'Pocitos',
        categoryName: null,
        zone: null,
        amount: null,
        wantsGeneralSavings: false,
      });
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('¿Qué tarjetas tenés?'),
      );
    });

    it('asks before browsing a category too (ej. "comida en Barrio Sur")', async () => {
      const { useCase, browseByCategory, savePendingQuery, sender } = build(
        intent({ categoryName: 'Restaurantes', zone: 'Barrio Sur' }),
        undefined,
        UNKNOWN_USER,
      );

      await useCase.execute('598', 'quiero comer algo en barrio sur');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(savePendingQuery.execute).toHaveBeenCalledWith('598', {
        merchantName: null,
        branchHint: null,
        categoryName: 'Restaurantes',
        zone: 'Barrio Sur',
        amount: null,
        wantsGeneralSavings: false,
      });
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('¿Qué tarjetas tenés?'),
      );
    });

    it('asks before a general-savings query too (ej. "qué me conviene hacer")', async () => {
      const { useCase, browseByCategory, savePendingQuery, sender } = build(
        intent({ wantsGeneralSavings: true }),
        undefined,
        UNKNOWN_USER,
      );

      await useCase.execute('598', 'qué me conviene hacer');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(savePendingQuery.execute).toHaveBeenCalledWith('598', {
        merchantName: null,
        branchHint: null,
        categoryName: null,
        zone: null,
        amount: null,
        wantsGeneralSavings: true,
      });
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('¿Qué tarjetas tenés?'),
      );
    });

    it('does not ask when the user says "dame todas" right away — answers unfiltered directly', async () => {
      const { useCase, browseByCategory, savePendingQuery, sender } = build(
        intent({ categoryName: 'Restaurantes', showAllBanks: true }),
        undefined,
        UNKNOWN_USER,
      );

      await useCase.execute('598', 'dame todas las ofertas de restaurantes');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Restaurantes',
        null,
        undefined,
        undefined,
      );
      expect(savePendingQuery.execute).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        DEFAULT_AI_REPLY,
      );
    });

    const PENDING_RESTAURANTES: PendingQuery = {
      merchantName: null,
      branchHint: null,
      categoryName: 'Restaurantes',
      zone: 'Barrio Sur',
      amount: null,
      wantsGeneralSavings: false,
    };

    it('resumes the pending query filtered when the follow-up answers with banks', async () => {
      const { useCase, browseByCategory, clearPendingQuery, sender } = build(
        intent({ banks: ['Itaú'] }),
        undefined,
        // Refleja el estado YA actualizado tras el setUserBanks de este mismo mensaje.
        {
          id: 'user-1',
          bankNames: ['Itaú'],
          pendingQuery: PENDING_RESTAURANTES,
          conversationContext: null,
          knownZone: null,
        },
      );

      await useCase.execute('598', 'tengo Itaú');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Restaurantes',
        'Barrio Sur',
        'user-1',
        undefined,
      );
      expect(clearPendingQuery.execute).toHaveBeenCalledWith('598');
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('Listo, guardé que tenés tarjetas de'),
      );
    });

    it('resumes the pending query unfiltered when the follow-up says "dame todas"', async () => {
      const { useCase, browseByCategory, clearPendingQuery, sender } = build(
        intent({ showAllBanks: true }),
        undefined,
        {
          id: 'user-1',
          bankNames: [],
          pendingQuery: PENDING_RESTAURANTES,
          conversationContext: null,
          knownZone: null,
        },
      );

      await useCase.execute('598', 'dame todas');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Restaurantes',
        'Barrio Sur',
        undefined,
        undefined,
      );
      expect(clearPendingQuery.execute).toHaveBeenCalledWith('598');
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        DEFAULT_AI_REPLY,
      );
    });

    it('drops the pending query (no infinite nagging) if the follow-up is unrelated — falls back to the generic clarification', async () => {
      const {
        useCase,
        browseByCategory,
        savePendingQuery,
        clearPendingQuery,
        sender,
      } = build(intent({}), undefined, {
        id: 'user-1',
        bankNames: [],
        pendingQuery: PENDING_RESTAURANTES,
        conversationContext: null,
        knownZone: null,
      });

      await useCase.execute('598', 'hola');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(savePendingQuery.execute).not.toHaveBeenCalled();
      expect(clearPendingQuery.execute).toHaveBeenCalledWith('598');
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('No entendí'),
      );
    });
  });

  describe('memoria conversacional de corto plazo (~30 min)', () => {
    const FARMACIAS_CONTEXT_QUERY: PendingQuery = {
      merchantName: null,
      branchHint: null,
      categoryName: 'Farmacias',
      zone: null,
      amount: null,
      wantsGeneralSavings: false,
    };

    function userWithContext(
      overrides: Partial<ConversationContext> = {},
      userOverrides: Partial<ResolvedUser> = {},
    ): ResolvedUser {
      return {
        ...KNOWN_USER,
        ...userOverrides,
        conversationContext: {
          query: FARMACIAS_CONTEXT_QUERY,
          recommendation: DEFAULT_RECOMMENDATION,
          updatedAt: minutesAgo(2),
          ...overrides,
        },
      };
    }

    it('fills the category from context when a follow-up only gives an amount ("600 pesos")', async () => {
      const { useCase, browseByCategory, saveConversationContext } = build(
        intent({ amount: 600 }),
        undefined,
        userWithContext(),
      );

      await useCase.execute('598', 'capaz gasto 600 pesos');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        null,
        'user-1',
        600,
      );
      expect(saveConversationContext.execute).toHaveBeenCalledWith(
        '598',
        expect.objectContaining({
          query: expect.objectContaining({
            categoryName: 'Farmacias',
            amount: 600,
          }),
          recommendation: DEFAULT_RECOMMENDATION,
        }),
      );
    });

    it('treats a new neighborhood as an informational zone follow-up ("y en Pocitos?")', async () => {
      const { useCase, browseByCategory } = build(
        intent({ zone: 'Pocitos' }),
        undefined,
        userWithContext(),
      );

      await useCase.execute('598', 'y en Pocitos?');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        'Pocitos',
        'user-1',
        undefined,
      );
    });

    it('ignores stale context (older than 30 min) — falls back to the generic clarification', async () => {
      const { useCase, browseByCategory, sender } = build(
        intent({ amount: 600 }),
        undefined,
        userWithContext({ updatedAt: minutesAgo(31) }),
      );

      await useCase.execute('598', 'capaz gasto 600 pesos');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('No entendí'),
      );
    });

    it('short-circuits a bare confirmation ("me sirve") with a deterministic reply, without calling the AI or the engine again', async () => {
      const {
        useCase,
        browseByCategory,
        responseGenerator,
        saveConversationContext,
        sender,
      } = build(
        intent({ confirmsRecommendation: true }),
        undefined,
        userWithContext(),
      );

      await useCase.execute('598', 'me sirve');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(responseGenerator.generate).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('Farmashop'),
      );
      expect(saveConversationContext.execute).toHaveBeenCalled();
    });

    it('short-circuits "mañana entonces" using the betterSoon already known from context', async () => {
      const recommendationWithBetterSoon: Recommendation = {
        ...DEFAULT_RECOMMENDATION,
        bestToday: null,
        betterSoon: {
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
        },
      };
      const { useCase, browseByCategory, sender } = build(
        intent({ prefersToWait: true }),
        undefined,
        userWithContext({ recommendation: recommendationWithBetterSoon }),
      );

      await useCase.execute('598', 'mañana entonces');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining("McDonald's"),
      );
    });

    it('falls through to the normal flow when prefersToWait has nothing better to point to', async () => {
      const { useCase, browseByCategory, responseGenerator } = build(
        intent({ prefersToWait: true }),
        undefined,
        userWithContext(), // DEFAULT_RECOMMENDATION.betterSoon is null
      );

      await useCase.execute('598', 'mejor espero');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        null,
        'user-1',
        undefined,
      );
      expect(responseGenerator.generate).toHaveBeenCalled();
    });

    it('does not short-circuit while a bank question is still pending, but still merges the topic from context', async () => {
      const {
        useCase,
        browseByCategory,
        responseGenerator,
        clearPendingQuery,
      } = build(
        intent({ confirmsRecommendation: true }),
        undefined,
        userWithContext({}, { pendingQuery: FARMACIAS_CONTEXT_QUERY }),
      );

      await useCase.execute('598', 'me sirve');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        null,
        'user-1',
        undefined,
      );
      expect(responseGenerator.generate).toHaveBeenCalled();
      expect(clearPendingQuery.execute).toHaveBeenCalledWith('598');
    });

    it('defaults to the known zone when neither the message nor recent context mention one', async () => {
      const { useCase, browseByCategory } = build(
        intent({ categoryName: 'Farmacias' }),
        undefined,
        { ...KNOWN_USER, knownZone: 'Pocitos' },
      );

      await useCase.execute('598', 'necesito una farmacia');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Farmacias',
        'Pocitos',
        'user-1',
        undefined,
      );
    });

    it('does not save context when there is nothing real to recommend', async () => {
      const { useCase, saveConversationContext } = build(
        intent({ merchantName: 'Nonexistent' }),
        { status: 'not_found' },
        KNOWN_USER,
      );

      await useCase.execute('598', 'Nonexistent');

      expect(saveConversationContext.execute).not.toHaveBeenCalled();
    });

    it('answers a bare neighborhood with no merchant/category by browsing all 3 categories, scoped by zone ("Pocitos" solo)', async () => {
      const { useCase, browseByCategory, sender } = build(intent({ zone: 'Pocitos' }));

      await useCase.execute('598', 'Pocitos');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        null,
        'Pocitos',
        'user-1',
        undefined,
      );
      expect(sender.sendTextMessage).toHaveBeenCalledWith('598', DEFAULT_AI_REPLY);
    });

    it('does not default to the known zone for a message with no topic at all (no false-positive "Pocitos" answer to "hola")', async () => {
      const { useCase, browseByCategory, sender } = build(
        intent({}),
        undefined,
        { ...KNOWN_USER, knownZone: 'Pocitos' },
      );

      await useCase.execute('598', 'hola');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('No entendí'),
      );
    });

    it('asks which banks first for a bare neighborhood too, when the user is unknown', async () => {
      const { useCase, browseByCategory, savePendingQuery, sender } = build(
        intent({ zone: 'Pocitos' }),
        undefined,
        UNKNOWN_USER,
      );

      await useCase.execute('598', 'Pocitos');

      expect(browseByCategory.execute).not.toHaveBeenCalled();
      expect(savePendingQuery.execute).toHaveBeenCalledWith('598', {
        merchantName: null,
        branchHint: null,
        categoryName: null,
        zone: 'Pocitos',
        amount: null,
        wantsGeneralSavings: false,
      });
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('¿Qué tarjetas tenés?'),
      );
    });
  });
});
