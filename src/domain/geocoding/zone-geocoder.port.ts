import { GeoPoint } from './geo-point';

export interface ZoneGeocoder {
  /**
   * Resuelve un barrio/zona dicho en lenguaje natural ("Barrio Sur") a
   * coordenadas reales, sesgado a Montevideo. null si no encuentra nada
   * confiable — nunca inventa una ubicación aproximada.
   */
  geocode(zone: string): Promise<GeoPoint | null>;
}

export const ZONE_GEOCODER = Symbol('ZONE_GEOCODER');
