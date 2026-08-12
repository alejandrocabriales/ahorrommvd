import { SearchResponse } from '../../domain/search/search-response';
import { Recommendation } from '../../domain/recommendation/recommendation';
import { toRecommendationOption } from './recommendation-mapping';

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
): Recommendation {
  const place = result.branchName ?? result.merchantChainName;

  return {
    queryLabel: place,
    zone,
    bestToday: result.today
      ? toRecommendationOption(
          result.today,
          result.merchantChainName,
          result.branchName ?? null,
        )
      : null,
    alternatives: [],
    betterSoon: result.better
      ? {
          option: toRecommendationOption(
            result.better.promotion,
            result.merchantChainName,
            result.branchName ?? null,
          ),
          daysFromNow: result.better.daysFromNow,
        }
      : null,
    estimatedSavingToday: result.estimatedSaving
      ? {
          amount: result.estimatedSaving.amount,
          cappedByBank: result.estimatedSaving.cappedByBank,
        }
      : null,
    nothingFound: !result.today && !result.better,
  };
}
