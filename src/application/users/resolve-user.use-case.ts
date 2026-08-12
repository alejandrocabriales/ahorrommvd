import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ResolvedUser {
  id: string;
  bankNames: string[];
}

/**
 * Solo lectura — no crea el User si no existe (eso lo hace
 * SetUserBanksUseCase cuando el usuario efectivamente cuenta sus tarjetas).
 * Un mensaje cualquiera ("hola") no debería crear una fila en `users`.
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

    return { id: user.id, bankNames: user.banks.map((b) => b.name) };
  }
}
