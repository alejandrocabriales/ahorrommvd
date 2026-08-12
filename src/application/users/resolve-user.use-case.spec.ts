import { ResolveUserUseCase } from './resolve-user.use-case';

describe('ResolveUserUseCase', () => {
  it('returns the user id and bank names when the user exists', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [{ name: 'Itaú' }, { name: 'Santander' }],
          pendingQuery: null,
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
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(result?.pendingQuery).toEqual(pendingQuery);
  });

  it('returns null without creating anything when the user has never been seen before', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const useCase = new ResolveUserUseCase(prisma as never);

    expect(await useCase.execute('unknown-number')).toBeNull();
  });
});
