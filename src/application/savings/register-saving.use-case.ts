import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GetPromotionComparisonUseCase } from '../search/get-promotion-comparison.use-case';
import { computeEstimatedSaving } from '../search/search-message';

export interface RegisterSavingResult {
  estimatedSaving: number;
  totalThisMonth: number;
  message: string;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Registro opcional de gasto (spec: "el valor principal del producto
 * ocurre antes de la compra" — esto es secundario, no crítico). No
 * mantenemos topes exactos, solo comercio/monto/ahorro estimado/fecha,
 * calculando el % con la mejor promo vigente HOY para esa sucursal.
 */
@Injectable()
export class RegisterSavingUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly getComparison: GetPromotionComparisonUseCase,
  ) {}

  async execute(
    whatsapp: string,
    branchId: string,
    amount: number,
  ): Promise<RegisterSavingResult> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new BadRequestException(`Sucursal "${branchId}" no existe`);
    }

    const comparison = await this.getComparison.execute(
      branch.merchantChainId,
      branchId,
    );
    const estimated = computeEstimatedSaving(comparison.today, amount);
    if (!estimated) {
      throw new BadRequestException(
        'No hay ninguna promoción vigente hoy para esa sucursal',
      );
    }

    const user = await this.prisma.user.upsert({
      where: { whatsapp },
      update: {},
      create: { whatsapp },
    });

    await this.prisma.savingLog.create({
      data: {
        userId: user.id,
        branchId,
        amount,
        estimatedSaving: estimated.amount,
      },
    });

    const totalThisMonth = await this.getTotalThisMonth(user.id);

    return {
      estimatedSaving: estimated.amount,
      totalThisMonth,
      message: `Registrado. Ahorraste aproximadamente $${estimated.amount}. Total registrado este mes: $${totalThisMonth}.`,
    };
  }

  private async getTotalThisMonth(userId: string): Promise<number> {
    const result = await this.prisma.savingLog.aggregate({
      where: { userId, createdAt: { gte: startOfMonth(new Date()) } },
      _sum: { estimatedSaving: true },
    });
    return Number(result._sum.estimatedSaving ?? 0);
  }
}
