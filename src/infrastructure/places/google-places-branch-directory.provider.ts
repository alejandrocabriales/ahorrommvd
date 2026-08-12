import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BranchCandidate } from '../../domain/branches/branch-candidate';
import {
  BRANCH_DIRECTORY_PROVIDER,
  BranchDirectoryProvider,
} from '../../domain/branches/branch-directory-provider.port';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// Centro de Montevideo — sesga la búsqueda a la ciudad (Text Search igual
// puede devolver algo fuera del radio si el match de texto es muy fuerte,
// esto solo prioriza, no filtra duro).
const MONTEVIDEO_BIAS = { latitude: -34.9011, longitude: -56.1645 };
const MONTEVIDEO_BIAS_RADIUS_METERS = 20000;

const NEIGHBORHOOD_TYPES = new Set([
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
]);

interface PlacesAddressComponent {
  longText?: string;
  types?: string[];
}

interface PlacesResult {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: PlacesAddressComponent[];
}

interface PlacesSearchResponse {
  places?: PlacesResult[];
  error?: { message: string };
}

function extractNeighborhood(
  components: PlacesAddressComponent[] = [],
): string | null {
  const match = components.find((c) =>
    (c.types ?? []).some((t) => NEIGHBORHOOD_TYPES.has(t)),
  );
  return match?.longText ?? null;
}

@Injectable()
export class GooglePlacesBranchDirectoryProvider
  implements BranchDirectoryProvider
{
  private readonly logger = new Logger(
    GooglePlacesBranchDirectoryProvider.name,
  );

  constructor(private readonly configService: ConfigService) {}

  async findBranches(chainName: string): Promise<BranchCandidate[]> {
    // getOrThrow acá adentro, no en el constructor — mismo motivo que los
    // providers de IA/scraping: que falle recién al buscar de verdad, no
    // que tumbe el boot de toda la app si todavía no está configurada la key.
    const apiKey = this.configService.getOrThrow<string>(
      'GOOGLE_PLACES_API_KEY',
    );

    const response = await fetch(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.location,places.addressComponents',
      },
      body: JSON.stringify({
        textQuery: `${chainName} Montevideo`,
        languageCode: 'es',
        locationBias: {
          circle: {
            center: MONTEVIDEO_BIAS,
            radius: MONTEVIDEO_BIAS_RADIUS_METERS,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Places API respondió ${response.status}: ${body}`);
    }

    const data = (await response.json()) as PlacesSearchResponse;
    if (data.error) {
      throw new Error(`Places API error: ${data.error.message}`);
    }

    // Sin nombre, dirección o coordenadas no hay nada confiable que guardar
    // — mismo criterio conservador que los scrapers de bancos: mejor
    // faltante que inventado.
    return (data.places ?? [])
      .filter((p) => p.displayName?.text && p.formattedAddress && p.location)
      .map((p) => ({
        name: p.displayName!.text,
        address: p.formattedAddress!,
        neighborhood: extractNeighborhood(p.addressComponents),
        latitude: p.location!.latitude,
        longitude: p.location!.longitude,
      }));
  }
}

export const GOOGLE_PLACES_BRANCH_DIRECTORY_PROVIDER = {
  provide: BRANCH_DIRECTORY_PROVIDER,
  useClass: GooglePlacesBranchDirectoryProvider,
};
