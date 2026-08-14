import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeoPoint } from '../../domain/geocoding/geo-point';
import { ZoneGeocoder } from '../../domain/geocoding/zone-geocoder.port';
import {
  isInMontevideo,
  MONTEVIDEO_BIAS,
  MONTEVIDEO_BIAS_RADIUS_METERS,
  PLACES_SEARCH_URL,
  PlacesAddressComponent,
} from './montevideo-places';

interface PlacesResult {
  location?: { latitude: number; longitude: number };
  addressComponents?: PlacesAddressComponent[];
}

interface PlacesSearchResponse {
  places?: PlacesResult[];
  error?: { message: string };
}

/**
 * Mismo endpoint y mismo sesgo que `GooglePlacesBranchDirectoryProvider`
 * (Text Search (New) sesgado a Montevideo) pero para resolver un barrio a
 * coordenadas en vez de un comercio a sucursales — probado en vivo: "Barrio
 * Sur", "Pocitos" y "Punta Carretas" resuelven limpio al punto del barrio
 * con `administrative_area_level_1` = Montevideo.
 */
@Injectable()
export class GooglePlacesZoneGeocoder implements ZoneGeocoder {
  private readonly logger = new Logger(GooglePlacesZoneGeocoder.name);

  constructor(private readonly configService: ConfigService) {}

  async geocode(zone: string): Promise<GeoPoint | null> {
    const apiKey = this.configService.getOrThrow<string>(
      'GOOGLE_PLACES_API_KEY',
    );

    const response = await fetch(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.location,places.addressComponents',
      },
      body: JSON.stringify({
        textQuery: `${zone} Montevideo`,
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

    const match = (data.places ?? []).find(
      (p) => p.location && isInMontevideo(p.addressComponents),
    );
    if (!match?.location) {
      this.logger.warn(`No pude geocodificar "${zone}" dentro de Montevideo`);
      return null;
    }

    return {
      latitude: match.location.latitude,
      longitude: match.location.longitude,
    };
  }
}
