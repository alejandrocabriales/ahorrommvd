import { Injectable, Logger } from '@nestjs/common';
import { GeoPoint } from '../../domain/geocoding/geo-point';
import { findMontevideoNeighborhood } from '../../domain/geocoding/montevideo-neighborhoods';
import {
  ZONE_GEOCODER,
  ZoneGeocoder,
} from '../../domain/geocoding/zone-geocoder.port';
import { GooglePlacesZoneGeocoder } from './google-places-zone-geocoder';

/**
 * Geocoder de zona que primero mira la tabla fija de barrios y solo si no
 * está ahí le pega a Places.
 *
 * El orden importa: el barrio es el 90% de lo que escribe la gente
 * ("estoy en Pocitos"), no se muda, y resolverlo en memoria saca de la
 * ruta caliente la única llamada externa por mensaje. En producción esa
 * llamada devolvió null y arrastró todo con ella — sin punto de zona no
 * hay filtro de distancia, no se elige sucursal y la respuesta sale sin
 * dirección (bug del 14/8: preguntó por Pocitos, contestamos sin decir
 * dónde queda el lugar).
 *
 * Places queda para lo que la tabla no cubre: una calle, una esquina, un
 * barrio que no listamos.
 */
@Injectable()
export class MontevideoZoneGeocoder implements ZoneGeocoder {
  private readonly logger = new Logger(MontevideoZoneGeocoder.name);

  constructor(private readonly places: GooglePlacesZoneGeocoder) {}

  async geocode(zone: string): Promise<GeoPoint | null> {
    const known = findMontevideoNeighborhood(zone);
    if (known) return known;

    try {
      return await this.places.geocode(zone);
    } catch (err) {
      // Que Places esté caído o sin API key no puede dejar al usuario sin
      // respuesta: devolvemos null y el flujo sigue sin filtro de cercanía,
      // igual que si el barrio no se reconociera.
      this.logger.error(`Places no pudo geocodificar "${zone}": ${err}`);
      return null;
    }
  }
}

export const MONTEVIDEO_ZONE_GEOCODER = {
  provide: ZONE_GEOCODER,
  useClass: MontevideoZoneGeocoder,
};
