import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

/**
 * Ya se resolvió (o se reemplazó por una pregunta nueva) — se borra para no
 * retomarla de nuevo en un mensaje futuro que no tiene nada que ver.
 */
@Injectable()
export class ClearPendingQueryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(whatsapp: string): Promise<void> {
    await this.prisma.user.update({
      where: { whatsapp },
      data: { pendingQuery: Prisma.DbNull },
    });
  }
}
