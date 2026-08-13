/**
 * Piezas compartidas entre todo lo que le pega a la Places API (New)
 * sesgado a Montevideo — hoy `GooglePlacesBranchDirectoryProvider` (backfill
 * de sucursales) y `GooglePlacesZoneGeocoder` (geocoding de barrio). Antes
 * vivían duplicadas en el provider de sucursales; se movieron acá cuando el
 * geocoder necesitó exactamente el mismo sesgo y el mismo chequeo de
 * departamento.
 */
export const PLACES_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';

// Centro de Montevideo — sesga la búsqueda a la ciudad (Text Search igual
// puede devolver algo fuera del radio si el match de texto es muy fuerte,
// esto solo prioriza, no filtra duro — por eso además hace falta el filtro
// duro de `isInMontevideo` más abajo).
export const MONTEVIDEO_BIAS = { latitude: -34.9011, longitude: -56.1645 };
export const MONTEVIDEO_BIAS_RADIUS_METERS = 20000;
export const MONTEVIDEO_ADMIN_AREA = 'Departamento de Montevideo';

export interface PlacesAddressComponent {
  longText?: string;
  types?: string[];
}

/**
 * `locationBias` en el request es un sesgo blando: Text Search puede (y
 * probado en vivo, lo hace) devolver resultados en otros departamentos o
 * directamente otros países cuando el nombre buscado es genérico. Solo
 * `administrative_area_level_1` en `addressComponents` confirma el
 * departamento real.
 */
export function isInMontevideo(
  components: PlacesAddressComponent[] = [],
): boolean {
  return components.some(
    (c) =>
      (c.types ?? []).includes('administrative_area_level_1') &&
      c.longText === MONTEVIDEO_ADMIN_AREA,
  );
}
