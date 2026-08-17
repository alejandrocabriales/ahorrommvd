import { USER_NEEDS, UserNeed } from '../intent/user-need';

/**
 * Lo que el usuario pidió, en sus términos — se guarda cuando todavía no
 * podemos responderlo (falta saber qué tarjetas tiene, o por qué barrio anda)
 * para retomarlo apenas conteste, en vez de hacerle repetir la pregunta
 * original. Es también la forma en que la memoria de corto plazo
 * (`ConversationContext`) recuerda de qué veníamos hablando.
 */
export interface PendingQuery {
  merchantName: string | null;
  branchHint: string | null;
  /** Qué necesita, cuando no nombró un comercio puntual (ver `UserNeed`). */
  need: UserNeed | null;
  /** Productos que nombró ("arroz", "tomate") — informativo, no hay precios por producto. */
  items: string[];
  zone: string | null;
  amount: number | null;
  wantsGeneralSavings: boolean;
}

/**
 * Cómo se leía el pedido antes de que existiera `UserNeed`: la IA elegía
 * directamente una de las 3 categorías del catálogo. Las filas de `users`
 * que quedaron guardadas con esa forma se siguen entendiendo.
 */
const NEED_BY_LEGACY_CATEGORY: Record<string, UserNeed> = {
  Supermercados: 'grocery',
  Farmacias: 'pharmacy',
  Restaurantes: 'prepared_food',
};

interface LegacyPendingQuery {
  categoryName?: string | null;
  need?: string | null;
  items?: unknown;
}

/**
 * `pendingQuery`/`conversationContext` viven como JSON en la base, así que
 * una fila escrita por la versión anterior sobrevive a este deploy con la
 * forma vieja (`categoryName`) y sin `items`. Normalizarla en la lectura es
 * más barato que una migración de datos, y evita que un usuario a mitad de
 * conversación cuando salió el deploy pierda el hilo.
 */
export function normalizePendingQuery(raw: unknown): PendingQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const query = raw as PendingQuery & LegacyPendingQuery;

  const need = USER_NEEDS.includes(query.need as UserNeed)
    ? (query.need as UserNeed)
    : (NEED_BY_LEGACY_CATEGORY[query.categoryName ?? ''] ?? null);

  return {
    merchantName: query.merchantName ?? null,
    branchHint: query.branchHint ?? null,
    need,
    items: Array.isArray(query.items)
      ? query.items.filter((item): item is string => typeof item === 'string')
      : [],
    zone: query.zone ?? null,
    amount: query.amount ?? null,
    wantsGeneralSavings: query.wantsGeneralSavings ?? false,
  };
}
