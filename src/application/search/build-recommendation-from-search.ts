import { SearchResponse } from '../../domain/search/search-response';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { toRecommendationOption } from './recommendation-mapping';
import { computeEstimatedSaving } from './search-message';

type ResolvedSearchResponse = Extract<SearchResponse, { status: 'resolved' }>;

/**
 * Mapea el resultado (ya calculado, sin IA) de un comercio puntual al
 * contrato único que consume el Response Generator. No hay "alternatives"
 * acá — el usuario preguntó por UN comercio, no tiene sentido ofrecerle
 * otros que no pidió.
 */
export function buildRecommendationFromSearch(
  result: ResolvedSearchResponse,
  zone: string | null,
  amount: number | null = null,
  asksLocation = false,
): Recommendation {
  const place = result.branchName ?? result.merchantChainName;
  const estimatedSavingBetterSoon = result.better
    ? computeEstimatedSaving(result.better.promotion, amount ?? undefined)
    : null;
  const neighborhood = result.neighborhood ?? null;
  const address = result.address ?? null;

  return {
    queryLabel: place,
    zone,
    bestToday: result.today
      ? toRecommendationOption(
          result.today,
          result.merchantChainName,
          result.branchName ?? null,
          neighborhood,
          address,
        )
      : null,
    alternatives: [],
    betterSoon: result.better
      ? {
          option: toRecommendationOption(
            result.better.promotion,
            result.merchantChainName,
            result.branchName ?? null,
            neighborhood,
            address,
          ),
          daysFromNow: result.better.daysFromNow,
          estimatedSaving: estimatedSavingBetterSoon
            ? {
                amount: estimatedSavingBetterSoon.amount,
                cappedByBank: estimatedSavingBetterSoon.cappedByBank,
              }
            : null,
        }
      : null,
    estimatedSavingToday: result.estimatedSaving
      ? {
          amount: result.estimatedSaving.amount,
          cappedByBank: result.estimatedSaving.cappedByBank,
        }
      : null,
    nothingFound: !result.today && !result.better,
    spentAmount: amount,
    asksLocation,
  };
}
