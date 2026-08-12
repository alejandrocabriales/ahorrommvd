import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * `null` significa "no filtrar" (no sabemos las tarjetas del usuario
 * todavía, o no nos pasaron userId) — hay que distinguirlo de un Set vacío,
 * que sí filtraría todo. Usado por GetPromotionComparisonUseCase y
 * BrowseByCategoryUseCase para no mostrar bancos que el usuario no puede
 * usar, una vez que sabemos cuáles tiene.
 */
export async function getAllowedBankNames(
  prisma: PrismaService,
  userId?: string,
): Promise<Set<string> | null> {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { banks: true },
  });
  if (!user || (user.banks as any).length === 0) return null;

  return new Set(user.banks.map((b) => b.name));
}
