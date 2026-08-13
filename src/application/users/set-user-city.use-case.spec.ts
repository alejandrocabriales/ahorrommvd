import { SetUserCityUseCase } from './set-user-city.use-case';

function buildPrismaMock() {
  return {
    user: {
      upsert: jest.fn().mockResolvedValue({ id: 'user-1', whatsapp: '598' }),
    },
  };
}

describe('SetUserCityUseCase', () => {
  it('saves the stated city and creates the user if new', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SetUserCityUseCase(prisma as never);

    const result = await useCase.execute('598', 'Maldonado');

    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { whatsapp: '598' },
      update: { knownCity: 'Maldonado' },
      create: { whatsapp: '598', knownCity: 'Maldonado' },
    });
    expect(result).toEqual({ userId: 'user-1', city: 'Maldonado' });
  });

  it('does nothing when the city is Montevideo itself — that is already the default', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SetUserCityUseCase(prisma as never);

    const result = await useCase.execute('598', 'montevideo');

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
