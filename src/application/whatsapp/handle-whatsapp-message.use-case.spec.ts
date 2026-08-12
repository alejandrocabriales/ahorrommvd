import { PaymentType } from '../../../generated/prisma/client';
import { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { PendingQuery } from '../../domain/users/pending-query';
import { SearchResponse } from '../../domain/search/search-response';
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
    ...overrides,
  };
}

const KNOWN_USER: ResolvedUser = {
  id: 'user-1',
  bankNames: ['Itaú'],
  pendingQuery: null,
};
const UNKNOWN_USER: ResolvedUser | null = null;

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
    const searchUseCase = {
      execute: jest.fn().mockResolvedValue(searchResult),
    } as unknown as SearchUseCase;
    const browseByCategory = {
      execute: jest.fn().mockResolvedValue([
        {
          merchantChainId: 'c1',
          merchantChainName: 'Farmashop',
          today: {
            bankName: 'Itaú',
            discountPercentage: 15,
            paymentType: PaymentType.CREDITO,
            cardName: null,
            capAmount: null,
            validFrom: new Date(),
            validUntil: new Date(),
            sourceUrl: 'https://example.com',
          },
        },
      ]),
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
    const sender = {
      sendTextMessage: jest.fn(),
    } as unknown as WhatsAppSenderService;

    const useCase = new HandleWhatsAppMessageUseCase(
      interpreter,
      searchUseCase,
      browseByCategory,
      registerSaving,
      resolveUser,
      setUserBanks,
      savePendingQuery,
      clearPendingQuery,
      sender,
    );
    return {
      useCase,
      interpreter,
      searchUseCase,
      browseByCategory,
      registerSaving,
      resolveUser,
      setUserBanks,
      savePendingQuery,
      clearPendingQuery,
      sender,
    };
  }

  it('builds a q from merchantName+branchHint, passes userId through, and forwards the resolved message', async () => {
    const { useCase, searchUseCase, sender } = build(
      intent({ merchantName: 'Ta-Ta', branchHint: 'Pocitos', amount: 4000 }),
      {
        status: 'resolved',
        merchantChainName: 'Ta-Ta',
        branchName: 'Ta-Ta Pocitos',
        message: 'Hoy podés ahorrar 20%.',
        today: null,
        better: null,
        upcoming: [],
      },
    );

    await useCase.execute('59891234567', 'Ta-Ta Pocitos 4000');

    expect(searchUseCase.execute).toHaveBeenCalledWith({
      q: 'Ta-Ta Pocitos',
      userId: 'user-1',
      amount: 4000,
    });
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '59891234567',
      'Hoy podés ahorrar 20%.',
    );
  });

  it('registers the spend and appends the confirmation when amount + a resolved branchId are both present', async () => {
    const { useCase, registerSaving, sender } = build(
      intent({ merchantName: 'Ta-Ta', amount: 4000 }),
      {
        status: 'resolved',
        merchantChainName: 'Ta-Ta',
        branchId: 'branch-pocitos',
        branchName: 'Ta-Ta Pocitos',
        message: 'Hoy podés ahorrar 20%.',
        today: null,
        better: null,
        upcoming: [],
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
      'Hoy podés ahorrar 20%.\n\nRegistrado. Ahorraste aproximadamente $800. Total registrado este mes: $2350.',
    );
  });

  it('does not register a spend when the merchant only resolved at chain level (no branchId)', async () => {
    const { useCase, registerSaving, sender } = build(
      intent({ merchantName: 'Bardo', amount: 500 }),
      {
        status: 'resolved',
        merchantChainName: 'Bardo',
        message:
          'No encontré promociones vigentes para Bardo en los próximos 7 días.',
        today: null,
        better: null,
        upcoming: [],
      },
    );

    await useCase.execute('598', 'Bardo 500');

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

  it('browses by category (passing userId through) when there is no specific merchant', async () => {
    const { useCase, browseByCategory, sender } = build(
      intent({ categoryName: 'Farmacias' }),
    );

    await useCase.execute('598', 'necesito una farmacia');

    expect(browseByCategory.execute).toHaveBeenCalledWith(
      'Farmacias',
      'user-1',
    );
    expect(sender.sendTextMessage).toHaveBeenCalledWith(
      '598',
      expect.stringContaining('Farmashop'),
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
    it('saves the mentioned banks and prepends a confirmation to the reply', async () => {
      const { useCase, setUserBanks, sender } = build(
        intent({ merchantName: 'Ta-Ta', banks: ['Itaú', 'Santander'] }),
        {
          status: 'resolved',
          merchantChainName: 'Ta-Ta',
          message: 'Hoy podés ahorrar 20%.',
          today: null,
          better: null,
          upcoming: [],
        },
      );

      await useCase.execute('598', 'tengo Itaú y Santander, Ta-Ta');

      expect(setUserBanks.execute).toHaveBeenCalledWith('598', [
        'Itaú',
        'Santander',
      ]);
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        'Listo, guardé que tenés tarjetas de Itaú, Santander.\n\nHoy podés ahorrar 20%.',
      );
    });

    it('bypasses the bank filter for this reply when the user asks for all offers, even with known banks', async () => {
      const { useCase, searchUseCase, sender } = build(
        intent({ merchantName: 'Ta-Ta', showAllBanks: true }),
        {
          status: 'resolved',
          merchantChainName: 'Ta-Ta',
          message: 'Hoy podés ahorrar 20% con Santander.',
          today: null,
          better: null,
          upcoming: [],
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
        'Hoy podés ahorrar 20% con Santander.',
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
        undefined,
      );
      expect(savePendingQuery.execute).not.toHaveBeenCalled();
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('Farmashop'),
      );
    });

    const PENDING_RESTAURANTES: PendingQuery = {
      merchantName: null,
      branchHint: null,
      categoryName: 'Restaurantes',
      zone: 'Barrio Sur',
      amount: null,
    };

    it('resumes the pending query filtered when the follow-up answers with banks', async () => {
      const { useCase, browseByCategory, clearPendingQuery, sender } = build(
        intent({ banks: ['Itaú'] }),
        undefined,
        // Refleja el estado YA actualizado tras el setUserBanks de este mismo mensaje.
        { id: 'user-1', bankNames: ['Itaú'], pendingQuery: PENDING_RESTAURANTES },
      );

      await useCase.execute('598', 'tengo Itaú');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Restaurantes',
        'user-1',
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
        { id: 'user-1', bankNames: [], pendingQuery: PENDING_RESTAURANTES },
      );

      await useCase.execute('598', 'dame todas');

      expect(browseByCategory.execute).toHaveBeenCalledWith(
        'Restaurantes',
        undefined,
      );
      expect(clearPendingQuery.execute).toHaveBeenCalledWith('598');
      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('Farmashop'),
      );
    });

    it('drops the pending query (no infinite nagging) if the follow-up is unrelated — falls back to the generic clarification', async () => {
      const { useCase, browseByCategory, savePendingQuery, clearPendingQuery, sender } =
        build(intent({}), undefined, {
          id: 'user-1',
          bankNames: [],
          pendingQuery: PENDING_RESTAURANTES,
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
});
