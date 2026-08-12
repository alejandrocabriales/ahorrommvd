import { SetUserBanksUseCase } from './set-user-banks.use-case';

const ITAU = { id: 'bank-itau', name: 'Itaú' };
const SANTANDER = { id: 'bank-santander', name: 'Santander' };

function buildPrismaMock() {
  return {
    bank: {
      findMany: jest.fn().mockResolvedValue([ITAU, SANTANDER]),
    },
    user: {
      upsert: jest.fn().mockResolvedValue({ id: 'user-1', whatsapp: '598' }),
    },
  };
}

describe('SetUserBanksUseCase', () => {
  it('creates the user (if new) connecting only banks that exist in our catalog', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SetUserBanksUseCase(prisma as never);

    const result = await useCase.execute('598', ['Itaú', 'Santander']);

    expect(prisma.bank.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['Itaú', 'Santander'] } },
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      update: {
        banks: { connect: [{ id: 'bank-itau' }, { id: 'bank-santander' }] },
      },
      create: {
        whatsapp: '598',
        banks: { connect: [{ id: 'bank-itau' }, { id: 'bank-santander' }] },
      },
    });
    expect(result).toEqual({
      userId: 'user-1',
      bankNames: ['Itaú', 'Santander'],
    });
  });

  it('connects (adds), never replaces — repeated calls accumulate via Prisma connect semantics', async () => {
    const prisma = buildPrismaMock();
    prisma.bank.findMany.mockResolvedValue([SANTANDER]);
    const useCase = new SetUserBanksUseCase(prisma as never);

    await useCase.execute('598', ['Santander']);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { banks: { connect: [{ id: 'bank-santander' }] } },
      }),
    );
  });
});
