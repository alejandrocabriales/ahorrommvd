import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PendingQuery,
  normalizePendingQuery,
} from '../../domain/users/pending-query';
import { ConversationContext } from '../../domain/users/conversation-context';

export interface ResolvedUser {
  id: string;
  bankNames: string[];
  pendingQuery: PendingQuery | null;
  conversationContext: ConversationContext | null;
  knownZone: string | null;
  knownCity: string | null;
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

    // Las dos columnas son JSON: una fila escrita por la versión anterior
    // trae la forma vieja del pedido (`categoryName`, sin `items`) — se
    // normaliza acá, en el borde, para que nada río abajo tenga que saber
    // que existió (ver normalizePendingQuery).
    const context = user.conversationContext as ConversationContext | null;
    const contextQuery = context && normalizePendingQuery(context.query);

    return {
      id: user.id,
      bankNames: user.banks.map((b) => b.name),
      pendingQuery: normalizePendingQuery(user.pendingQuery),
      conversationContext:
        context && contextQuery ? { ...context, query: contextQuery } : null,
      knownZone: user.knownZone,
      knownCity: user.knownCity,
    };
  }
}
