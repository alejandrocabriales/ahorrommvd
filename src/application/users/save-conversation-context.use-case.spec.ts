import { ConversationContext } from '../../domain/users/conversation-context';
import { SaveConversationContextUseCase } from './save-conversation-context.use-case';

const CONTEXT: ConversationContext = {
  query: {
    merchantName: null,
    branchHint: null,
    need: 'pharmacy',
    items: [],
    zone: 'Pocitos',
    amount: null,
    wantsGeneralSavings: false,
  },
  recommendation: {
    queryLabel: 'Farmacias',
  } as ConversationContext['recommendation'],
  updatedAt: '2026-08-12T12:00:00.000Z',
};

describe('SaveConversationContextUseCase', () => {
  it('upserts the context and sets knownZone when the query carries a zone', async () => {
    const prisma = { user: { upsert: jest.fn().mockResolvedValue({}) } };
    const useCase = new SaveConversationContextUseCase(prisma as never);

    await useCase.execute('598', CONTEXT);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      update: { conversationContext: CONTEXT, knownZone: 'Pocitos' },
      create: {
        whatsapp: '598',
        conversationContext: CONTEXT,
        knownZone: 'Pocitos',
      },
    });
  });

  it('leaves knownZone untouched (undefined) when this query has no zone', async () => {
    const prisma = { user: { upsert: jest.fn().mockResolvedValue({}) } };
    const useCase = new SaveConversationContextUseCase(prisma as never);
    const contextWithoutZone: ConversationContext = {
      ...CONTEXT,
      query: { ...CONTEXT.query, zone: null },
    };

    await useCase.execute('598', contextWithoutZone);

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      update: { conversationContext: contextWithoutZone, knownZone: undefined },
      create: {
        whatsapp: '598',
        conversationContext: contextWithoutZone,
        knownZone: undefined,
      },
    });
  });
});
