import { distanceKm } from './distance';
import { GeoPoint } from './geo-point';

/**
 * Centro de Montevideo y radio que tomamos como "el departamento", para
 * decidir con coordenadas sueltas si un local nos sirve.
 *
 * Existe porque hay fuentes que dan lat/long sin dirección ni departamento
 * (el feed de Itaú, ver ItauBenefitsScraper) y ahí `isInMontevideo` no
 * aplica: ese chequea `administrative_area_level_1` de Google, que acá no
 * tenemos. 25 km cubre el departamento entero — Punta del Este, el caso
 * real que se coló como si fuera Montevideo, está a ~110 km.
 */
export const MONTEVIDEO_CENTER: GeoPoint = {
  latitude: -34.9011,
  longitude: -56.1645,
};

export const MONTEVIDEO_RADIUS_KM = 25;

export function isInMontevideoArea(point: GeoPoint): boolean {
  return distanceKm(MONTEVIDEO_CENTER, point) <= MONTEVIDEO_RADIUS_KM;
}
