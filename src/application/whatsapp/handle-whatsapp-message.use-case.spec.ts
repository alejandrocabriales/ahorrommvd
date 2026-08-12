import { PaymentType } from '../../../generated/prisma/client';
import { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
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

const KNOWN_USER: ResolvedUser = { id: 'user-1', bankNames: ['Itaú'] };

describe('HandleWhatsAppMessageUseCase', () => {
  // Por default el usuario YA tiene bancos conocidos, así los tests de
  // contenido no se pisan con el tip de "contame tus tarjetas" — ese
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

    it('appends a tip asking for the user cards when we still do not know them', async () => {
      const { useCase, sender } = build(
        intent({ merchantName: 'Ta-Ta' }),
        {
          status: 'resolved',
          merchantChainName: 'Ta-Ta',
          message: 'Hoy podés ahorrar 20%.',
          today: null,
          better: null,
          upcoming: [],
        },
        null, // resolveUser -> nunca escribió antes, no sabemos sus bancos
      );

      await useCase.execute('598', 'Ta-Ta');

      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        '598',
        expect.stringContaining('contame qué tarjetas tenés'),
      );
    });

    it('does not append the tip once we already know the user banks', async () => {
      const { useCase, sender } = build(intent({ merchantName: 'Ta-Ta' }), {
        status: 'resolved',
        merchantChainName: 'Ta-Ta',
        message: 'Hoy podés ahorrar 20%.',
        today: null,
        better: null,
        upcoming: [],
      });

      await useCase.execute('598', 'Ta-Ta');

      const [, sentMessage] = (sender.sendTextMessage as jest.Mock).mock
        .calls[0] as [string, string];
      expect(sentMessage).not.toContain('contame qué tarjetas tenés');
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
      const [, sentMessage] = (sender.sendTextMessage as jest.Mock).mock
        .calls[0] as [string, string];
      expect(sentMessage).not.toContain('contame qué tarjetas tenés');
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
});
