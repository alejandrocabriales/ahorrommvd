import { ConfigService } from '@nestjs/config';
import { GooglePlacesZoneGeocoder } from './google-places-zone-geocoder';

function buildConfig(): ConfigService {
  return { getOrThrow: () => 'fake-api-key' } as unknown as ConfigService;
}

function mockPlacesResponse(places: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ places }),
    text: () => Promise.resolve(''),
  });
}

// Capturado en vivo contra "Barrio Sur Montevideo".
const BARRIO_SUR = {
  location: { latitude: -34.9108776, longitude: -56.1881819 },
  addressComponents: [
    {
      longText: 'Departamento de Montevideo',
      types: ['administrative_area_level_1'],
    },
  ],
};

const OUT_OF_MONTEVIDEO = {
  location: { latitude: -34.9061, longitude: -55.7469 },
  addressComponents: [
    {
      longText: 'Departamento de Canelones',
      types: ['administrative_area_level_1'],
    },
  ],
};

describe('GooglePlacesZoneGeocoder', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves a real Montevideo barrio to its coordinates', async () => {
    mockPlacesResponse([BARRIO_SUR]);
    const geocoder = new GooglePlacesZoneGeocoder(buildConfig());

    const result = await geocoder.geocode('Barrio Sur');

    expect(result).toEqual({ latitude: -34.9108776, longitude: -56.1881819 });
  });

  it('returns null when the only match is outside Montevideo (never invents a point)', async () => {
    mockPlacesResponse([OUT_OF_MONTEVIDEO]);
    const geocoder = new GooglePlacesZoneGeocoder(buildConfig());

    const result = await geocoder.geocode('Ciudad de la Costa');

    expect(result).toBeNull();
  });

  it('returns null when Places finds nothing at all', async () => {
    mockPlacesResponse([]);
    const geocoder = new GooglePlacesZoneGeocoder(buildConfig());

    const result = await geocoder.geocode('asdkjaslkdj');

    expect(result).toBeNull();
  });

  it('skips a result missing coordinates and falls through to the next valid one', async () => {
    mockPlacesResponse([
      { addressComponents: BARRIO_SUR.addressComponents },
      BARRIO_SUR,
    ]);
    const geocoder = new GooglePlacesZoneGeocoder(buildConfig());

    const result = await geocoder.geocode('Barrio Sur');

    expect(result).toEqual({ latitude: -34.9108776, longitude: -56.1881819 });
  });
});
