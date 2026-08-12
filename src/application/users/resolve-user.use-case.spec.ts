import { ResolveUserUseCase } from './resolve-user.use-case';

describe('ResolveUserUseCase', () => {
  it('returns the user id and bank names when the user exists', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          banks: [{ name: 'Itaú' }, { name: 'Santander' }],
        }),
      },
    };
    const useCase = new ResolveUserUseCase(prisma as never);

    const result = await useCase.execute('598');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      include: { banks: true },
    });
    expect(result).toEqual({ id: 'user-1', bankNames: ['Itaú', 'Santander'] });
  });

  it('returns null without creating anything when the user has never been seen before', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const useCase = new ResolveUserUseCase(prisma as never);

    expect(await useCase.execute('unknown-number')).toBeNull();
  });
});
