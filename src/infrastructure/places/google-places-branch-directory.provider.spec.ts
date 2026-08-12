import { ConfigService } from '@nestjs/config';
import { GooglePlacesBranchDirectoryProvider } from './google-places-branch-directory.provider';

function buildConfig(): ConfigService {
  return {
    getOrThrow: () => 'fake-api-key',
  } as unknown as ConfigService;
}

function mockPlacesResponse(places: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ places }),
    text: () => Promise.resolve(''),
  }) as unknown as typeof fetch;
}

// Casos reales capturados a mano contra la Places API (New) buscando "Soho
// Montevideo" y "Chajá Montevideo" — el bug original: junto al comercio
// real, Text Search trae negocios sin relación que comparten barrio, y para
// "Chajá" el único resultado fue una calle, no un comercio.
const SOHO_REAL_BAR = {
  displayName: { text: 'Su Bar' },
  formattedAddress: 'Juan D. Jackson 1151, 11200 Montevideo, Uruguay',
  location: { latitude: -34.9082544, longitude: -56.1732123 },
  addressComponents: [
    {
      longText: 'Departamento de Montevideo',
      types: ['administrative_area_level_1'],
    },
  ],
  primaryType: 'restaurant',
  types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
};

const SOHO_WRONG_TYPE = {
  displayName: { text: 'Soho Pinturas' },
  formattedAddress: 'Monseñor Domingo Tamburini, 11300 Montevideo, Uruguay',
  location: { latitude: -34.9083539, longitude: -56.1490791 },
  addressComponents: [
    {
      longText: 'Departamento de Montevideo',
      types: ['administrative_area_level_1'],
    },
  ],
  primaryType: 'building_materials_store',
  types: ['building_materials_store', 'home_goods_store', 'store'],
};

const SOHO_WRONG_NAME_RIGHT_TYPE = {
  displayName: { text: 'TALCAFÉ SOHO' },
  formattedAddress: 'Maldonado 1827, 11200 Montevideo, Uruguay',
  location: { latitude: -34.9084315, longitude: -56.1755436 },
  addressComponents: [
    {
      longText: 'Departamento de Montevideo',
      types: ['administrative_area_level_1'],
    },
  ],
  primaryType: 'coffee_shop',
  types: ['coffee_shop', 'cafe', 'restaurant', 'food'],
};

const CHAJA_STREET_NOT_A_BUSINESS = {
  displayName: { text: 'El Chajá' },
  formattedAddress: 'El Chajá, 12500 Montevideo, Uruguay',
  location: { latitude: -34.7897418, longitude: -56.2320961 },
  addressComponents: [
    {
      longText: 'Departamento de Montevideo',
      types: ['administrative_area_level_1'],
    },
  ],
  types: ['route'],
};

const OUT_OF_MONTEVIDEO = {
  displayName: { text: 'Santo Café' },
  formattedAddress: 'Av. Gral. Rumiñahui s/n, Quito, Ecuador',
  location: { latitude: -0.3030941, longitude: -78.4555663 },
  addressComponents: [
    { longText: 'Pichincha', types: ['administrative_area_level_1'] },
  ],
  primaryType: 'cafe',
  types: ['cafe', 'restaurant', 'food'],
};

describe('GooglePlacesBranchDirectoryProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('discards results outside Montevideo department even when the country/coords look plausible', async () => {
    mockPlacesResponse([OUT_OF_MONTEVIDEO]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches('Santo Café', 'Restaurantes');

    expect(result).toEqual([]);
  });

  it('discards a result whose type does not match the chain category (paint store matched by neighborhood name)', async () => {
    mockPlacesResponse([SOHO_WRONG_TYPE]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches('Soho', 'Restaurantes');

    expect(result).toEqual([]);
  });

  it('discards a same-category result whose name does not correspond to the chain (unrelated coffee shop in the same district)', async () => {
    mockPlacesResponse([SOHO_WRONG_NAME_RIGHT_TYPE]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches('Soho', 'Restaurantes');

    expect(result).toEqual([]);
  });

  it('discards a result that is a street, not a business', async () => {
    mockPlacesResponse([CHAJA_STREET_NOT_A_BUSINESS]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches('Chajá', 'Restaurantes');

    expect(result).toEqual([]);
  });

  it('keeps a result that passes all four checks', async () => {
    mockPlacesResponse([SOHO_REAL_BAR]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches('Su Bar', 'Restaurantes');

    expect(result).toEqual([
      {
        name: 'Su Bar',
        address: 'Juan D. Jackson 1151, 11200 Montevideo, Uruguay',
        neighborhood: null,
        latitude: -34.9082544,
        longitude: -56.1732123,
      },
    ]);
  });

  it('keeps a branch named "Brand + location" (Google convention for chain outlets)', async () => {
    mockPlacesResponse([
      {
        displayName: { text: "McDonald's Punta Carretas Shopping" },
        formattedAddress: 'Ellauri 350, Montevideo, Uruguay',
        location: { latitude: -34.91, longitude: -56.16 },
        addressComponents: [
          {
            longText: 'Departamento de Montevideo',
            types: ['administrative_area_level_1'],
          },
        ],
        primaryType: 'fast_food_restaurant',
        types: ['fast_food_restaurant', 'restaurant', 'food'],
      },
    ]);
    const provider = new GooglePlacesBranchDirectoryProvider(buildConfig());

    const result = await provider.findBranches("McDonald's", 'Restaurantes');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("McDonald's Punta Carretas Shopping");
  });
});
