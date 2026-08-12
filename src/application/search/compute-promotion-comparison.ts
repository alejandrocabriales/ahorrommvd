import {
  PromotionComparison,
  PromotionSummary,
} from '../../domain/search/search-result';

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function activeOn(
  promotions: PromotionSummary[],
  day: Date,
): PromotionSummary[] {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  return promotions.filter(
    (p) => p.validFrom <= dayEnd && p.validUntil >= dayStart,
  );
}

function pickBest(promotions: PromotionSummary[]): PromotionSummary | null {
  if (promotions.length === 0) return null;
  return [...promotions].sort((a, b) => {
    if (b.discountPercentage !== a.discountPercentage) {
      return b.discountPercentage - a.discountPercentage;
    }
    return (b.capAmount ?? 0) - (a.capAmount ?? 0);
  })[0];
}

/**
 * Funcionalidad diferenciadora obligatoria del spec: hoy vs. próximos 7
 * días. "better" solo se llena si el próximo mejor % le gana estrictamente
 * al de hoy (o no hay nada hoy) — si lo de hoy ya es lo mejor de la semana,
 * no tiene sentido decirle al usuario que espere.
 *
 * `allowedBankNames`: cuando sabemos con qué bancos tiene tarjeta el
 * usuario, filtramos ANTES de comparar — no tiene sentido decirle "OCA
 * tiene 40%" a alguien que no tiene tarjeta OCA, no puede usar ese
 * descuento. `null`/`undefined` (todavía no sabemos sus tarjetas) no
 * filtra nada, se comporta como antes.
 */
export function computePromotionComparison(
  promotions: PromotionSummary[],
  today: Date,
  allowedBankNames?: Set<string> | null,
): PromotionComparison {
  const candidates = allowedBankNames
    ? promotions.filter((p) => allowedBankNames.has(p.bankName))
    : promotions;

  const bestToday = pickBest(activeOn(candidates, today));

  let better: PromotionComparison['better'] = null;
  for (let daysFromNow = 1; daysFromNow <= 7; daysFromNow++) {
    const candidate = pickBest(
      activeOn(candidates, addDays(today, daysFromNow)),
    );
    if (!candidate) continue;

    const beatsToday =
      !bestToday || candidate.discountPercentage > bestToday.discountPercentage;
    const beatsCurrentBetter =
      !better ||
      candidate.discountPercentage > better.promotion.discountPercentage;

    if (beatsToday && beatsCurrentBetter) {
      better = { promotion: candidate, daysFromNow };
    }
  }

  return { today: bestToday, better, upcoming: candidates };
}
