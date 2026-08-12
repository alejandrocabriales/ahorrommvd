import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BranchCandidate } from '../../domain/branches/branch-candidate';
import { CATEGORY_PLACE_TYPES } from '../../domain/branches/category-place-types';
import {
  BRANCH_DIRECTORY_PROVIDER,
  BranchDirectoryProvider,
} from '../../domain/branches/branch-directory-provider.port';
import { MvpCategoryName } from '../../domain/scraping/mvp-category';
import { normalizeMerchantName } from '../../domain/scraping/normalize-merchant-name';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// Centro de Montevideo — sesga la búsqueda a la ciudad (Text Search igual
// puede devolver algo fuera del radio si el match de texto es muy fuerte,
// esto solo prioriza, no filtra duro — por eso además hace falta el filtro
// duro de `isInMontevideo` más abajo).
const MONTEVIDEO_BIAS = { latitude: -34.9011, longitude: -56.1645 };
const MONTEVIDEO_BIAS_RADIUS_METERS = 20000;
const MONTEVIDEO_ADMIN_AREA = 'Departamento de Montevideo';

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
  primaryType?: string;
  types?: string[];
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

/**
 * `locationBias` en el request es un sesgo blando: Text Search puede (y
 * probado en vivo, lo hace) devolver resultados en otros departamentos o
 * directamente otros países cuando el nombre de la cadena es genérico
 * ("Santo Café" matcheó una cafetería en Quito). `administrative_area_level_1`
 * es el único campo de `addressComponents` que confirma departamento real.
 */
function isInMontevideo(components: PlacesAddressComponent[] = []): boolean {
  return components.some(
    (c) =>
      (c.types ?? []).includes('administrative_area_level_1') &&
      c.longText === MONTEVIDEO_ADMIN_AREA,
  );
}

/**
 * Descarta resultados cuyo tipo no corresponde al rubro de la cadena —
 * probado en vivo contra "Soho Montevideo": junto al bar real, Text Search
 * trae una casa de pinturas, un salón de belleza y una concesionaria solo
 * porque están en el barrio "Soho".
 */
function matchesCategory(
  place: PlacesResult,
  categoryName: MvpCategoryName,
): boolean {
  const allowed = CATEGORY_PLACE_TYPES[categoryName];
  const types = place.types ?? (place.primaryType ? [place.primaryType] : []);
  return types.some((t) => allowed.has(t));
}

/**
 * El resultado tiene que ser la cadena buscada, no cualquier negocio que
 * comparta rubro y esté cerca — probado en vivo: buscar "Soho" también trae
 * restaurantes reales sin ninguna relación ("Su Bar", "Mercado Ferrando").
 * Prefijo normalizado en vez de igualdad exacta porque Google suele nombrar
 * la sucursal como "Marca + local" (ej. "McDonald's Punta Carretas
 * Shopping" para la cadena "McDonald's").
 */
function matchesChainName(displayName: string, chainName: string): boolean {
  return normalizeMerchantName(displayName).startsWith(
    normalizeMerchantName(chainName),
  );
}

@Injectable()
export class GooglePlacesBranchDirectoryProvider
  implements BranchDirectoryProvider
{
  private readonly logger = new Logger(
    GooglePlacesBranchDirectoryProvider.name,
  );

  constructor(private readonly configService: ConfigService) {}

  async findBranches(
    chainName: string,
    categoryName: MvpCategoryName,
  ): Promise<BranchCandidate[]> {
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
          'places.displayName,places.formattedAddress,places.location,places.addressComponents,places.primaryType,places.types',
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

    // Cuatro filtros duros antes de confiar en un resultado — probados en
    // vivo contra casos reales que se colaron sin esto ("El Chajá" resultó
    // ser una calle, no un comercio; "Soho" trajo 20 negocios sin relación
    // solo por compartir barrio; "Santo Café" matcheó una cafetería en
    // Quito): nombre/dirección/coordenadas presentes, departamento
    // Montevideo, tipo de comercio del rubro esperado, y nombre que
    // corresponda a la cadena buscada. Mismo criterio conservador que los
    // scrapers de bancos: mejor faltante que inventado.
    return (data.places ?? [])
      .filter((p) => p.displayName?.text && p.formattedAddress && p.location)
      .filter((p) => isInMontevideo(p.addressComponents))
      .filter((p) => matchesCategory(p, categoryName))
      .filter((p) => matchesChainName(p.displayName!.text, chainName))
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
