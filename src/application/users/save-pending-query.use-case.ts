import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { PendingQuery } from '../../domain/users/pending-query';

/**
 * Guarda qué preguntó el usuario mientras esperamos que nos cuente sus
 * tarjetas — crea el User si es la primera vez que escribe (misma lógica
 * que SetUserBanksUseCase: acá sí vale la pena la fila, hay algo que
 * retomar en el próximo mensaje).
 */
@Injectable()
export class SavePendingQueryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(whatsapp: string, query: PendingQuery): Promise<void> {
    // PendingQuery es un tipo cerrado (no un índice string), Prisma exige
    // InputJsonValue con index signature — es JSON-serializable de verdad,
    // el cast es solo para calmar al compilador.
    const json = query as unknown as Prisma.InputJsonValue;
    await this.prisma.user.upsert({
      where: { whatsapp },
      update: { pendingQuery: json },
      create: { whatsapp, pendingQuery: json },
    });
  }
}
