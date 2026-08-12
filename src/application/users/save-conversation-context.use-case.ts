import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { ConversationContext } from '../../domain/users/conversation-context';

/**
 * Guarda de qué veníamos hablando, para que un seguimiento ("600 pesos",
 * "y en Pocitos?") no arranque de cero — se llama cada vez que hay una
 * Recommendation real que recordar, no solo cuando el usuario pregunta
 * algo nuevo desde cero.
 *
 * También actualiza `knownZone` si esta consulta trajo un barrio, pero
 * sin pisarlo cuando no lo trajo: `undefined` en un `update` de Prisma
 * significa "no tocar esta columna", a diferencia de `null` que la
 * borraría — así el barrio conocido sobrevive a mensajes que no lo
 * mencionan de nuevo.
 */
@Injectable()
export class SaveConversationContextUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(whatsapp: string, context: ConversationContext): Promise<void> {
    const json = context as unknown as Prisma.InputJsonValue;
    const knownZone = context.query.zone ?? undefined;

    await this.prisma.user.upsert({
      where: { whatsapp },
      update: { conversationContext: json, knownZone },
      create: { whatsapp, conversationContext: json, knownZone },
    });
  }
}
