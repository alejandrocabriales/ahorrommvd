import { EstimatedSaving } from '../../domain/search/search-response';
import {
  PromotionComparison,
  PromotionSummary,
} from '../../domain/search/search-result';
import { CategoryOption } from './browse-by-category.use-case';

/** Ej. "Ta-Ta 4000" -> 20% hoy -> ahorro estimado $800, respetando el tope del banco si hay. */
export function computeEstimatedSaving(
  today: PromotionSummary | null,
  amount?: number,
): EstimatedSaving | null {
  if (!today || amount === undefined || amount <= 0) return null;

  const raw = amount * (today.discountPercentage / 100);
  const cappedByBank = today.capAmount !== null && raw > today.capAmount;

  return {
    amount: Math.round(cappedByBank ? (today.capAmount as number) : raw),
    discountPercentage: today.discountPercentage,
    cappedByBank,
  };
}

function dayLabel(daysFromNow: number): string {
  return daysFromNow === 1 ? 'mañana' : `en ${daysFromNow} días`;
}

/**
 * Texto determinístico, sin IA — la redacción con lenguaje natural es
 * trabajo de Semana 4 (IA), esto es un template fijo para poder probar el
 * motor ya mismo vía HTTP.
 */
export function buildSearchMessage(params: {
  merchantChainName: string;
  branchName?: string;
  comparison: PromotionComparison;
  estimatedSaving?: EstimatedSaving | null;
}): string {
  const { branchName, merchantChainName, comparison, estimatedSaving } = params;
  const place = branchName ?? merchantChainName;
  const { today, better } = comparison;

  if (!today && !better) {
    return `No encontré promociones vigentes para ${place} en los próximos 7 días.`;
  }

  const parts: string[] = [];

  if (today) {
    const savingText = estimatedSaving
      ? ` (aproximadamente $${estimatedSaving.amount})`
      : '';
    parts.push(
      `Hoy podés ahorrar ${today.discountPercentage}% con ${today.bankName}${savingText}.`,
    );
  } else {
    parts.push(`Hoy no encontré una promoción vigente para ${place}.`);
  }

  if (better) {
    parts.push(
      `Pero ${dayLabel(better.daysFromNow)} ${place} tiene ${better.promotion.discountPercentage}% ` +
        `con ${better.promotion.bankName}. Si tu compra no es urgente, esperar podría aumentar tu ahorro.`,
    );
  }

  return parts.join(' ');
}

/** Para "voy al súper" / "necesito una farmacia": no hay comercio puntual, mostramos opciones. */
export function buildCategoryBrowseMessage(
  categoryName: string,
  options: CategoryOption[],
): string {
  if (options.length === 0) {
    return `No encontré promociones vigentes hoy en ${categoryName.toLowerCase()}.`;
  }

  const lines = options.map(
    (o) =>
      `- ${o.merchantChainName}: ${o.today.discountPercentage}% con ${o.today.bankName}`,
  );

  return `Hoy en ${categoryName.toLowerCase()} tenés estas opciones:\n${lines.join('\n')}\n¿Cuál te interesa?`;
}
