import { BranchCandidate } from '../../domain/branches/branch-candidate';
import { BranchDirectoryProvider } from '../../domain/branches/branch-directory-provider.port';
import { GeoPoint } from '../../domain/geocoding/geo-point';
import type { ZoneGeocoder } from '../../domain/geocoding/zone-geocoder.port';
import { SyncBranchesUseCase } from './sync-branches.use-case';

interface FakeChain {
  id: string;
  name: string;
  category: { name: string };
  branches: Array<{
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
}

const CHAINS: FakeChain[] = [
  {
    id: 'chain-tata',
    name: 'Ta-Ta',
    category: { name: 'Supermercados' },
    branches: [],
  },
  {
    id: 'chain-chaja',
    name: 'Chajá',
    category: { name: 'Restaurantes' },
    branches: [],
  },
];

function candidate(overrides: Partial<BranchCandidate>): BranchCandidate {
  return {
    name: 'Ta-Ta',
    address: 'Av. Brasil 2846, Montevideo',
    neighborhood: 'Pocitos',
    latitude: -34.9,
    longitude: -56.16,
    ...overrides,
  };
}

function fakeProvider(
  byChain: Record<string, BranchCandidate[] | Error>,
): BranchDirectoryProvider {
  return {
    findBranches: (chainName: string) => {
      const result = byChain[chainName] ?? [];
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

function fakeGeocoder(
  byAddress: Record<string, GeoPoint | null> = {},
): ZoneGeocoder {
  return {
    geocode: jest.fn((text: string) =>
      Promise.resolve(byAddress[text] ?? null),
    ),
  };
}

function buildPrismaMock(chains: FakeChain[] = CHAINS) {
  const upserts: Array<{ chainId: string; name: string }> = [];
  const updates: Array<{ id: string; latitude: number }> = [];
  const addressUpdates: Array<{
    id: string;
    address: string;
    neighborhood: string | null;
  }> = [];
  return {
    upserts,
    updates,
    addressUpdates,
    merchantChain: { findMany: jest.fn().mockResolvedValue(chains) },
    branch: {
      upsert: jest.fn(
        (args: {
          where: {
            merchantChainId_name: { merchantChainId: string; name: string };
          };
        }) => {
          upserts.push({
            chainId: args.where.merchantChainId_name.merchantChainId,
            name: args.where.merchantChainId_name.name,
          });
          return Promise.resolve({});
        },
      ),
      update: jest.fn(
        (args: {
          where: { id: string };
          data: {
            latitude?: number;
            longitude?: number;
            address?: string;
            neighborhood?: string | null;
          };
        }) => {
          if (args.data.address !== undefined) {
            addressUpdates.push({
              id: args.where.id,
              address: args.data.address,
              neighborhood: args.data.neighborhood ?? null,
            });
          } else {
            updates.push({
              id: args.where.id,
              latitude: args.data.latitude as number,
            });
          }
          return Promise.resolve({});
        },
      ),
    },
  };
}

describe('SyncBranchesUseCase', () => {
  it('busca las cadenas sin sucursal GEOLOCALIZADA, no las sin sucursal — una sucursal sin coordenadas no se puede recomendar', async () => {
    const prisma = buildPrismaMock();
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      fakeProvider({}),
      fakeGeocoder(),
    );

    await useCase.execute();

    expect(prisma.merchantChain.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { branches: { none: { latitude: { not: null } } } },
          { branches: { some: { address: null } } },
        ],
      },
      include: {
        category: true,
        branches: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });
  });

  it('guarda lo que encuentra el provider', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': [
        candidate({ name: 'Ta-Ta Pocitos', neighborhood: 'Pocitos' }),
        candidate({ name: 'Ta-Ta Cerro', neighborhood: 'Cerro' }),
      ],
      Chajá: [],
    });
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      provider,
      fakeGeocoder(),
    );

    const results = await useCase.execute();

    expect(results).toEqual([
      { chainName: 'Ta-Ta', found: 2, saved: 2, geocoded: 0, addressed: 0 },
      { chainName: 'Chajá', found: 0, saved: 0, geocoded: 0, addressed: 0 },
    ]);
    expect(prisma.upserts).toEqual([
      { chainId: 'chain-tata', name: 'Ta-Ta Pocitos' },
      { chainId: 'chain-tata', name: 'Ta-Ta Cerro' },
    ]);
  });

  it('desambigua nombres repetidos de la misma cadena antes de guardar (el unique es cadena+nombre)', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': [
        candidate({ name: 'Ta-Ta', neighborhood: 'Pocitos' }),
        candidate({ name: 'Ta-Ta', neighborhood: 'Cerro' }),
      ],
      Chajá: [],
    });
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      provider,
      fakeGeocoder(),
    );

    await useCase.execute();

    expect(prisma.upserts.map((u) => u.name)).toEqual([
      'Ta-Ta',
      'Ta-Ta (Cerro)',
    ]);
  });

  it('completa las coordenadas de una sucursal ya cargada geocodificando su dirección', async () => {
    // Las sucursales del seed (Ta-Ta, Devoto, Farmashop) tienen dirección y
    // no coordenadas: sin esto quedan invisibles para el motor para siempre.
    const prisma = buildPrismaMock([
      {
        id: 'chain-tata',
        name: 'Ta-Ta',
        category: { name: 'Supermercados' },
        branches: [
          {
            id: 'branch-1',
            name: 'Ta-Ta Pocitos',
            address: 'Av. Brasil 2846',
            latitude: null,
            longitude: null,
          },
          {
            id: 'branch-2',
            name: 'Ta-Ta Sin Dirección',
            address: null,
            latitude: null,
            longitude: null,
          },
        ],
      },
    ]);
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      fakeProvider({}),
      fakeGeocoder({
        'Av. Brasil 2846': { latitude: -34.9, longitude: -56.16 },
      }),
    );

    const results = await useCase.execute();

    expect(prisma.updates).toEqual([{ id: 'branch-1', latitude: -34.9 }]);
    expect(results[0].geocoded).toBe(1);
  });

  it('deja la sucursal como está si el geocoding falla', async () => {
    const prisma = buildPrismaMock([
      {
        id: 'chain-tata',
        name: 'Ta-Ta',
        category: { name: 'Supermercados' },
        branches: [
          {
            id: 'branch-1',
            name: 'Ta-Ta Pocitos',
            address: 'Dirección inventada',
            latitude: null,
            longitude: null,
          },
        ],
      },
    ]);
    const geocoder: ZoneGeocoder = {
      geocode: jest.fn(() => Promise.reject(new Error('Places 500'))),
    };
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      fakeProvider({}),
      geocoder,
    );

    const results = await useCase.execute();

    expect(prisma.updates).toEqual([]);
    expect(results[0].geocoded).toBe(0);
  });

  it('le completa la dirección a una sucursal que vino del feed del banco (nombre y coordenadas, sin calle)', async () => {
    const prisma = buildPrismaMock([
      {
        id: 'chain-freddo',
        name: 'Freddo',
        category: { name: 'Restaurantes' },
        branches: [
          {
            id: 'branch-1',
            name: 'Freddo Pocitos',
            address: null,
            latitude: -34.91605,
            longitude: -56.15886,
          },
        ],
      },
    ]);
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      fakeProvider({
        // Mismo local, a ~30 m y con otro nombre en Google.
        Freddo: [
          candidate({
            name: 'Freddo',
            address: '21 de Setiembre 2997, Montevideo',
            neighborhood: 'Pocitos',
            latitude: -34.9163,
            longitude: -56.159,
          }),
        ],
      }),
      fakeGeocoder(),
    );

    const results = await useCase.execute();

    expect(prisma.addressUpdates).toEqual([
      {
        id: 'branch-1',
        address: '21 de Setiembre 2997, Montevideo',
        neighborhood: 'Pocitos',
      },
    ]);
    expect(results[0].addressed).toBe(1);
    // Y no la guarda otra vez con el nombre de Google: es el mismo local.
    expect(prisma.upserts).toEqual([]);
    expect(results[0].saved).toBe(0);
  });

  it('sí guarda un local de Google que no está encima de ninguno que ya tengamos', async () => {
    const prisma = buildPrismaMock([
      {
        id: 'chain-freddo',
        name: 'Freddo',
        category: { name: 'Restaurantes' },
        branches: [
          {
            id: 'branch-1',
            name: 'Freddo Pocitos',
            address: 'Ya tiene dirección',
            latitude: -34.91605,
            longitude: -56.15886,
          },
        ],
      },
    ]);
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      fakeProvider({
        Freddo: [
          candidate({
            name: 'Freddo Carrasco',
            latitude: -34.8885,
            longitude: -56.0583,
          }),
        ],
      }),
      fakeGeocoder(),
    );

    const results = await useCase.execute();

    expect(prisma.upserts).toEqual([
      { chainId: 'chain-freddo', name: 'Freddo Carrasco' },
    ]);
    expect(results[0].addressed).toBe(0);
  });

  it('registra el error de una cadena cuya búsqueda falla, sin romper el resto', async () => {
    const prisma = buildPrismaMock();
    const provider = fakeProvider({
      'Ta-Ta': new Error('Places API respondió 500: boom'),
      Chajá: [candidate({ name: 'Chajá Pocitos' })],
    });
    const useCase = new SyncBranchesUseCase(
      prisma as never,
      provider,
      fakeGeocoder(),
    );

    const results = await useCase.execute();

    expect(results[0]).toEqual({
      chainName: 'Ta-Ta',
      found: 0,
      saved: 0,
      geocoded: 0,
      addressed: 0,
      error: 'Places API respondió 500: boom',
    });
    expect(results[1]).toEqual({
      chainName: 'Chajá',
      found: 1,
      saved: 1,
      geocoded: 0,
      addressed: 0,
    });
  });
});
