import { ResolveUserUseCase } from './resolve-user.use-case';

describe('ResolveUserUseCase', () => {
  it('returns the user id and bank names when the user exists', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [{ name: 'Itaú' }, { name: 'Santander' }],
          pendingQuery: null,
          conversationContext: null,
          knownZone: null,
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      include: { banks: true },
    });
    expect(result).toEqual({
      id: 'user-1',
      bankNames: ['Itaú', 'Santander'],
      pendingQuery: null,
      conversationContext: null,
      knownZone: null,
    });
  });

  it('surfaces a pending query when the user has one waiting to be resumed', async () => {
    const pendingQuery = {
      merchantName: null,
      branchHint: null,
      categoryName: 'Restaurantes',
      zone: 'Barrio Sur',
      amount: null,
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [],
          pendingQuery,
          conversationContext: null,
          knownZone: null,
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(result?.pendingQuery).toEqual(pendingQuery);
  });

  it('surfaces the conversation context and known zone when present', async () => {
    const conversationContext = {
      query: {
        merchantName: null,
        branchHint: null,
        categoryName: 'Farmacias',
        zone: null,
        amount: null,
        wantsGeneralSavings: false,
      },
      recommendation: { queryLabel: 'Farmacias' },
      updatedAt: '2026-08-12T12:00:00.000Z',
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [],
          pendingQuery: null,
          conversationContext,
          knownZone: 'Pocitos',
          knownCity: null,
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(result?.conversationContext).toEqual(conversationContext);
    expect(result?.knownZone).toBe('Pocitos');
  });

  it('surfaces the known city when the user said they are elsewhere', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [],
          pendingQuery: null,
          conversationContext: null,
          knownZone: null,
          knownCity: 'Maldonado',
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(result?.knownCity).toBe('Maldonado');
  });

  it('returns null without creating anything when the user has never been seen before', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const useCase = new ResolveUserUseCase(prisma as never);

    expect(await useCase.execute('unknown-number')).toBeNull();
  });
});
