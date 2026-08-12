import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PendingQuery } from '../../domain/users/pending-query';

export interface ResolvedUser {
  id: string;
  bankNames: string[];
  pendingQuery: PendingQuery | null;
}

/**
 * Solo lectura — no crea el User si no existe (eso lo hace
 * SetUserBanksUseCase/SavePendingQueryUseCase cuando hay algo real que
 * guardar). Un mensaje cualquiera ("hola") no debería crear una fila en
 * `users`.
 */
@Injectable()
export class ResolveUserUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(whatsapp: string): Promise<ResolvedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { whatsapp },
      include: { banks: true },
    });
    if (!user) return null;

    return {
      id: user.id,
      bankNames: user.banks.map((b) => b.name),
      pendingQuery: (user.pendingQuery as PendingQuery | null) ?? null,
    };
  }
}
