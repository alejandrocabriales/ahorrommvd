import { BadRequestException } from '@nestjs/common';
import { PaymentType } from '../../../generated/prisma/client';
import { GetPromotionComparisonUseCase } from '../search/get-promotion-comparison.use-case';
import { RegisterSavingUseCase } from './register-saving.use-case';

const BRANCH = { id: 'branch-pocitos', merchantChainId: 'chain-tata' };
const TODAY_PROMO = {
  bankName: 'Santander',
  discountPercentage: 20,
  paymentType: PaymentType.CREDITO,
  cardName: null,
  capAmount: null,
  validFrom: new Date(),
  validUntil: new Date(),
  sourceUrl: 'https://example.com',
};

function buildPrismaMock(overrides: { existingTotalThisMonth?: number } = {}) {
  return {
    branch: { findUnique: jest.fn().mockResolvedValue(BRANCH) },
    user: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', whatsapp: '59891234567' }),
    },
    savingLog: {
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { estimatedSaving: overrides.existingTotalThisMonth ?? 800 },
      }),
    },
  };
}

describe('RegisterSavingUseCase', () => {
  it('matches the spec example: Ta-Ta 4000 at 20% -> registered with $800 saving', async () => {
    const prisma = buildPrismaMock();
    const getComparison = {
      execute: jest
        .fn()
        .mockResolvedValue({ today: TODAY_PROMO, better: null, upcoming: [] }),
    } as unknown as GetPromotionComparisonUseCase;
    const useCase = new RegisterSavingUseCase(prisma as never, getComparison);

    const result = await useCase.execute('59891234567', 'branch-pocitos', 4000);

    expect(result.estimatedSaving).toBe(800);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { whatsapp: '59891234567' },
      update: {},
      create: { whatsapp: '59891234567' },
    });
    expect(prisma.savingLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        branchId: 'branch-pocitos',
        amount: 4000,
        estimatedSaving: 800,
      },
    });
    expect(result.message).toBe(
      'Registrado. Ahorraste aproximadamente $800. Total registrado este mes: $800.',
    );
  });

  it('throws instead of registering when there is no promotion active today for that branch', async () => {
    const prisma = buildPrismaMock();
    const getComparison = {
      execute: jest
        .fn()
        .mockResolvedValue({ today: null, better: null, upcoming: [] }),
    } as unknown as GetPromotionComparisonUseCase;
    const useCase = new RegisterSavingUseCase(prisma as never, getComparison);

    await expect(
      useCase.execute('598', 'branch-pocitos', 4000),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.savingLog.create).not.toHaveBeenCalled();
  });

  it('throws for a branch that does not exist', async () => {
    const prisma = buildPrismaMock();
    prisma.branch.findUnique.mockResolvedValue(null);
    const getComparison = {
      execute: jest.fn(),
    } as unknown as GetPromotionComparisonUseCase;
    const useCase = new RegisterSavingUseCase(prisma as never, getComparison);

    await expect(useCase.execute('598', 'nope', 1000)).rejects.toThrow(
      BadRequestException,
    );
  });
});
