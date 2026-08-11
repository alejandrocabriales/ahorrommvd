import { PaymentType } from '../../../generated/prisma/client';
import { MessageInterpreter } from '../../domain/ai/message-interpreter.port';
import { ParsedIntent } from '../../domain/ai/parsed-intent';
import { SearchResponse } from '../../domain/search/search-response';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { RegisterSavingUseCase } from '../savings/register-saving.use-case';
import { BrowseByCategoryUseCase } from '../search/browse-by-category.use-case';
import { SearchUseCase } from '../search/search.use-case';
import { HandleWhatsAppMessageUseCase } from './handle-whatsapp-message.use-case';

function intent(overrides: Partial<ParsedIntent>): ParsedIntent {
  return {
    merchantName: null,
    branchHint: null,
    categoryName: null,
    zone: null,
    amount: null,
    ...overrides,
  };
}

describe('HandleWhatsAppMessageUseCase', () => {
  function build(parsedIntent: ParsedIntent, searchResult?: SearchResponse) {
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
    const sender = {
      sendTextMessage: jest.fn(),
    } as unknown as WhatsAppSenderService;

    const useCase = new HandleWhatsAppMessageUseCase(
      interpreter,
      searchUseCase,
      browseByCategory,
      registerSaving,
      sender,
    );
    return {
      useCase,
      interpreter,
      searchUseCase,
      browseByCategory,
      registerSaving,
      sender,
    };
  }

  it('builds a q from merchantName+branchHint and forwards the resolved message', async () => {
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

  it('browses by category when there is no specific merchant', async () => {
    const { useCase, browseByCategory, sender } = build(
      intent({ categoryName: 'Farmacias' }),
    );

    await useCase.execute('598', 'necesito una farmacia');

    expect(browseByCategory.execute).toHaveBeenCalledWith('Farmacias');
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
});
