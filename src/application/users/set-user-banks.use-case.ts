import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MvpBankName } from '../../domain/scraping/bank-name';

export interface SetUserBanksResult {
  userId: string;
  bankNames: string[];
}

/**
 * Suma bancos a los que ya sabíamos del usuario — no reemplaza. Si hoy dice
 * "tengo Itaú" y mañana "también OCA", termina con los dos, no solo el
 * último. Crea el User si es la primera vez que este número escribe algo
 * que vale la pena guardar.
 */
@Injectable()
export class SetUserBanksUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    whatsapp: string,
    bankNames: MvpBankName[],
  ): Promise<SetUserBanksResult> {
    // Solo bancos que existen de verdad en nuestro catálogo (Itaú/Santander/OCA
    // seedeados) — MvpBankName ya acota esto en el tipo, pero por si el
    // seed no corrió, no fallamos silenciosamente ni inventamos un Bank.
    const banks = await this.prisma.bank.findMany({
      where: { name: { in: bankNames } },
    });

    const user = await this.prisma.user.upsert({
      where: { whatsapp },
      update: { banks: { connect: banks.map((b) => ({ id: b.id })) } },
      create: {
        whatsapp,
        banks: { connect: banks.map((b) => ({ id: b.id })) },
      },
    });

    return { userId: user.id, bankNames: banks.map((b) => b.name) };
  }
}
