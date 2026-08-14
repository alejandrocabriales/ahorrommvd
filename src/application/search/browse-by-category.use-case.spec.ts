import { PaymentType } from '../../../generated/prisma/client';
import { GeoPoint } from '../../domain/geocoding/geo-point';
import type { ZoneGeocoder } from '../../domain/geocoding/zone-geocoder.port';
import { addDays, endOfDay, startOfDay } from './compute-promotion-comparison';
import { BrowseByCategoryUseCase } from './browse-by-category.use-case';

// Coordenada default para candidatos "verificados" cuando el test no le
// importa dónde exactamente — cerca del centro de Montevideo.
const MONTEVIDEO_POINT: GeoPoint = { latitude: -34.9, longitude: -56.16 };

interface FakeBranchRow {
  name: string;
  neighborhood: string | null;
  address: string;
  latitude: number;
  longitude: number;
}

interface FakePromoRow {
  merchantChainId: string;
  merchantChain: { name: string; branches: FakeBranchRow[] };
  bank: { name: string };
  /** null en un beneficio sin % (ej. un 2x1) — ahí viene benefitLabel. */
  discountPercentage: number | null;
  benefitLabel?: string | null;
  paymentType: PaymentType;
  cardName: string | null;
  capAmount: number | null;
  validFrom: Date;
  validUntil: Date;
  sourceUrl: string;
}

function branch(
  point: GeoPoint,
  name = 'Sucursal',
  neighborhood: string | null = null,
): FakeBranchRow {
  return {
    name,
    neighborhood,
    address: `${name}, Montevideo`,
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function row(
  overrides: Partial<Omit<FakePromoRow, 'merchantChain'>> & {
    merchantChainId: string;
    merchantChainName: string;
    /** default true — la mayoría de los tests no le importa el filtro de Montevideo. */
    hasVerifiedBranch?: boolean;
    /** coordenada puntual de la sucursal, para tests de distancia — implica hasVerifiedBranch. */
    branchPoint?: GeoPoint;
    /** sucursales completas, para tests que miran nombre/barrio/dirección. */
    branches?: FakeBranchRow[];
  },
): FakePromoRow {
  const today = new Date();
  const {
    merchantChainName,
    hasVerifiedBranch,
    branchPoint,
    branches: branchRows,
    ...rest
  } = overrides;
  const branches =
    branchRows ??
    (branchPoint
      ? [branch(branchPoint, merchantChainName)]
      : hasVerifiedBranch === false
        ? []
        : [branch(MONTEVIDEO_POINT, merchantChainName)]);
  return {
    benefitLabel: null,
    bank: { name: 'Itaú' },
    discountPercentage: 10,
    paymentType: PaymentType.CREDITO,
    cardName: null,
    capAmount: null,
    validFrom: startOfDay(today),
    validUntil: endOfDay(today),
    sourceUrl: 'https://example.com',
    ...rest,
    merchantChain: { name: merchantChainName, branches },
  };
}

function buildPrisma(rows: FakePromoRow[], userBankNames?: string[]) {
  return {
    promotion: { findMany: jest.fn().mockResolvedValue(rows) },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          userBankNames
            ? { banks: userBankNames.map((name) => ({ name })) }
            : null,
        ),
    },
  };
}

/** default: no geocodifica nada (como si el zone no se pudiera resolver) — así los tests que no le importa la distancia no se ven afectados por el filtro nuevo. */
function fakeGeocoder(point: GeoPoint | null = null): ZoneGeocoder {
  return { geocode: jest.fn().mockResolvedValue(point) };
}

describe('BrowseByCategoryUseCase', () => {
  it('picks the highest % active today as bestToday, and up to 3 others as alternatives', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 25,
        bank: { name: 'Itaú' },
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
        bank: { name: 'Santander' },
      }),
      row({
        merchantChainId: 'c3',
        merchantChainName: 'Vidal',
        discountPercentage: 10,
        bank: { name: 'OCA' },
      }),
      row({
        merchantChainId: 'c4',
        merchantChainName: 'Nix',
        discountPercentage: 5,
        bank: { name: 'Itaú' },
      }),
      row({
        merchantChainId: 'c5',
        merchantChainName: 'Sarandí',
        discountPercentage: 2,
        bank: { name: 'Itaú' },
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday).toMatchObject({
      merchantChainName: 'Farmashop',
      bankName: 'Itaú',
      discountPercentage: 25,
    });
    expect(rec.alternatives).toHaveLength(3);
    expect(rec.alternatives.map((a) => a.merchantChainName)).toEqual([
      'San Roque',
      'Vidal',
      'Nix', // Sarandí (2%) queda afuera, solo entran las 3 mejores
    ]);
    expect(rec.nothingFound).toBe(false);
  });

  it('keeps only the best promo per chain (no duplicate chain in bestToday/alternatives)', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 10,
      }),
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 25,
      }), // mismo chain, mejor %
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday?.discountPercentage).toBe(25);
    expect(rec.alternatives).toEqual([
      expect.objectContaining({ merchantChainName: 'San Roque' }),
    ]);
  });

  it('sets betterSoon when a future day beats today, with the right daysFromNow', async () => {
    const today = new Date();
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 40,
        validFrom: startOfDay(addDays(today, 2)),
        validUntil: endOfDay(addDays(today, 2)),
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.bestToday?.discountPercentage).toBe(15);
    expect(rec.betterSoon).toMatchObject({
      daysFromNow: 2,
      option: expect.objectContaining({
        merchantChainName: 'San Roque',
        discountPercentage: 40,
      }),
    });
  });

  it('leaves betterSoon null when nothing upcoming beats today (no false "conviene esperar")', async () => {
    const today = new Date();
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 40,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 15,
        validFrom: startOfDay(addDays(today, 1)),
        validUntil: endOfDay(addDays(today, 1)),
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.betterSoon).toBeNull();
  });

  it('marks nothingFound when there are no promotions at all in the window', async () => {
    const prisma = buildPrisma([]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.nothingFound).toBe(true);
    expect(rec.bestToday).toBeNull();
    expect(rec.alternatives).toEqual([]);
  });

  it('searches across all categories when categoryName is null (ej. "quiero ahorrar hoy")', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'Ta-Ta',
        discountPercentage: 20,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute(null, null, undefined);

    expect(prisma.promotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          merchantChain: expect.anything(),
        }),
      }),
    );
    expect(rec.bestToday).toMatchObject({
      merchantChainName: 'Ta-Ta',
      discountPercentage: 20,
    });
    expect(rec.queryLabel).toBe('lo mejor de hoy en Montevideo');
  });

  it('computes estimatedSavingToday against bestToday when an amount comes from a follow-up message', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
        bank: { name: 'Itaú' },
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined, 600);

    expect(rec.estimatedSavingToday).toEqual({
      amount: 90,
      cappedByBank: false,
    });
    expect(rec.spentAmount).toBe(600);
  });

  it('also computes estimatedSaving for betterSoon when an amount is known, so $ hoy se puede comparar contra $ esperando', async () => {
    const today = new Date();
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 20,
        capAmount: 1500,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'San Roque',
        discountPercentage: 40,
        capAmount: 800,
        validFrom: startOfDay(addDays(today, 1)),
        validUntil: endOfDay(addDays(today, 1)),
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined, 4000);

    expect(rec.estimatedSavingToday).toEqual({
      amount: 800,
      cappedByBank: false,
    });
    expect(rec.betterSoon?.estimatedSaving).toEqual({
      amount: 800,
      cappedByBank: true,
    });
  });

  it('leaves estimatedSavingToday/spentAmount null when no amount was given', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 15,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, undefined);

    expect(rec.estimatedSavingToday).toBeNull();
    expect(rec.spentAmount).toBeNull();
  });

  it('prefers a chain with a verified Montevideo branch over a higher % chain with none (Soho bug: out-of-town merchant beating a real local one)', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Soho',
        discountPercentage: 25,
        hasVerifiedBranch: false,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'La Pasiva Arocena',
        discountPercentage: 25,
        hasVerifiedBranch: true,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', 'Barrio Sur', undefined);

    expect(rec.bestToday?.merchantChainName).toBe('La Pasiva Arocena');
    expect(rec.alternatives).toEqual([]);
    expect(rec.unverifiedOnly).toBe(false);
  });

  it('recommends nothing (not the unverified chain) when no chain in the category has a verified Montevideo branch, and says why with unverifiedOnly', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Bardo',
        discountPercentage: 15,
        hasVerifiedBranch: false,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null, undefined);

    expect(rec.bestToday).toBeNull();
    expect(rec.alternatives).toEqual([]);
    expect(rec.nothingFound).toBe(true);
    expect(rec.unverifiedOnly).toBe(true);
  });

  it('keeps unverifiedOnly false when there was simply nothing in the window (no promos at all is a different answer than "nothing confirmed in Montevideo")', async () => {
    const prisma = buildPrisma([]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null, undefined);

    expect(rec.nothingFound).toBe(true);
    expect(rec.unverifiedOnly).toBe(false);
  });

  it('recommends nothing when nothing verified survives the bank filter (bug found live: Itaú+OCA user asked where to eat, got Soho/Punta del Este and Chajá)', async () => {
    const prisma = buildPrisma(
      [
        row({
          merchantChainId: 'c1',
          merchantChainName: 'Soho',
          discountPercentage: 25,
          bank: { name: 'Itaú' },
          hasVerifiedBranch: false,
        }),
        row({
          merchantChainId: 'c2',
          merchantChainName: 'Chajá',
          discountPercentage: 10,
          bank: { name: 'OCA' },
          hasVerifiedBranch: false,
        }),
      ],
      ['Itaú', 'OCA'],
    );
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', 'Buceo', 'user-itau-oca');

    expect(rec.bestToday).toBeNull();
    expect(rec.alternatives).toEqual([]);
    expect(rec.nothingFound).toBe(true);
    expect(rec.unverifiedOnly).toBe(true);
  });

  it('no filtra por banco en la query — necesita ver los otros bancos para poder decir qué se está perdiendo', async () => {
    const prisma = buildPrisma([], ['Itaú']);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    await useCase.execute('Restaurantes', null, 'user-itau');

    expect(prisma.promotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ bank: expect.anything() }),
      }),
    );
  });

  it('con sus tarjetas no hay nada pero con otro banco sí: lo ofrece como dato, no como recomendación', async () => {
    const prisma = buildPrisma(
      [
        row({
          merchantChainId: 'c1',
          merchantChainName: 'Soho',
          discountPercentage: 25,
          bank: { name: 'Itaú' },
          hasVerifiedBranch: false,
        }),
        row({
          merchantChainId: 'c2',
          merchantChainName: 'Porto Vanila',
          discountPercentage: 20,
          bank: { name: 'Santander' },
          branches: [branch(MONTEVIDEO_POINT, 'Porto Vanila Caffé', 'Pocitos')],
        }),
      ],
      ['Itaú'],
    );
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null, 'user-itau');

    expect(rec.bestToday).toBeNull();
    expect(rec.nothingFound).toBe(true);
    expect(rec.bestWithOtherBank).toMatchObject({
      merchantChainName: 'Porto Vanila',
      bankName: 'Santander',
      discountPercentage: 20,
    });
  });

  it('no ofrece otro banco cuando esa promo tampoco está confirmada en Montevideo', async () => {
    const prisma = buildPrisma(
      [
        row({
          merchantChainId: 'c1',
          merchantChainName: 'Soho',
          discountPercentage: 25,
          bank: { name: 'Itaú' },
          hasVerifiedBranch: false,
        }),
        row({
          merchantChainId: 'c2',
          merchantChainName: 'Chajá',
          discountPercentage: 20,
          bank: { name: 'Santander' },
          hasVerifiedBranch: false,
        }),
      ],
      ['Itaú'],
    );
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null, 'user-itau');

    expect(rec.bestWithOtherBank).toBeNull();
  });

  it('no habla de otros bancos cuando sí encontró algo con las tarjetas del usuario', async () => {
    const prisma = buildPrisma(
      [
        row({
          merchantChainId: 'c1',
          merchantChainName: 'Farmashop',
          discountPercentage: 10,
          bank: { name: 'Itaú' },
        }),
        row({
          merchantChainId: 'c2',
          merchantChainName: 'San Roque',
          discountPercentage: 40,
          bank: { name: 'Santander' },
        }),
      ],
      ['Itaú'],
    );
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', null, 'user-itau');

    expect(rec.bestToday?.merchantChainName).toBe('Farmashop');
    expect(rec.bestWithOtherBank).toBeNull();
  });

  it('passes the query label and zone through untouched, and never invents a "neighborhood" without real branch data', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 10,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', 'Pocitos', undefined);

    expect(rec.queryLabel).toBe('Farmacias');
    expect(rec.zone).toBe('Pocitos');
    expect(rec.bestToday?.neighborhood).toBeNull();
  });

  it('keeps candidates unfiltered when the zone cannot be geocoded (never blocks a recommendation over a geocoding miss)', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 10,
      }),
    ]);
    // fakeGeocoder() default resuelve a null, como si "Pocitos" no se
    // pudiera geocodificar (API caída, zona no reconocida, etc.)
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Farmacias', 'Pocitos', undefined);

    expect(rec.bestToday?.merchantChainName).toBe('Farmashop');
  });

  it('prefers a chain near the geocoded zone over a higher % chain far away in a different barrio ("no me sirve un restaurante en Pocitos si estoy en Barrio Sur")', async () => {
    const barrioSur: GeoPoint = {
      latitude: -34.9108776,
      longitude: -56.1881819,
    };
    const pocitos: GeoPoint = { latitude: -34.9085301, longitude: -56.1504057 }; // ~3.5km de Barrio Sur, otro barrio

    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Restaurante en Pocitos',
        discountPercentage: 25,
        branchPoint: pocitos,
      }),
      row({
        merchantChainId: 'c2',
        merchantChainName: 'Restaurante en Barrio Sur',
        discountPercentage: 15,
        branchPoint: barrioSur,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(barrioSur),
    );

    const rec = await useCase.execute('Restaurantes', 'Barrio Sur', undefined);

    expect(rec.bestToday?.merchantChainName).toBe('Restaurante en Barrio Sur');
    expect(rec.alternatives).toEqual([]);
  });

  it('falls back to all verified candidates when none are within range of the geocoded zone, flagging zoneWidened so the reply admits it is not nearby', async () => {
    const barrioSur: GeoPoint = {
      latitude: -34.9108776,
      longitude: -56.1881819,
    };
    const pocitos: GeoPoint = { latitude: -34.9085301, longitude: -56.1504057 };

    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Restaurante en Pocitos',
        discountPercentage: 25,
        branchPoint: pocitos,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(barrioSur),
    );

    const rec = await useCase.execute('Restaurantes', 'Barrio Sur', undefined);

    expect(rec.bestToday?.merchantChainName).toBe('Restaurante en Pocitos');
    expect(rec.nothingFound).toBe(false);
    expect(rec.zoneWidened).toBe(true);
  });

  it('names the branch closest to the geocoded zone, so the reply can say where to go instead of talking about the chain in the abstract', async () => {
    const pocitos: GeoPoint = { latitude: -34.9085301, longitude: -56.1504057 };
    const cercaDePocitos: GeoPoint = {
      latitude: -34.9105,
      longitude: -56.1535,
    };

    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Farmashop',
        discountPercentage: 25,
        branches: [
          branch(
            { latitude: -34.8841377, longitude: -56.1696498 },
            'Farmashop Prado',
            'Prado',
          ),
          branch(cercaDePocitos, 'Farmashop 21 de Setiembre', 'Pocitos'),
        ],
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(pocitos),
    );

    const rec = await useCase.execute('Farmacias', 'Pocitos', undefined);

    expect(rec.bestToday).toMatchObject({
      branchName: 'Farmashop 21 de Setiembre',
      neighborhood: 'Pocitos',
      // Sin el ", Montevideo": la dirección se recorta al mapear (ver
      // shortAddress) — el producto es solo de Montevideo, repetirlo es ruido.
      address: 'Farmashop 21 de Setiembre',
    });
    expect(rec.zoneWidened).toBe(false);
  });

  it('ofrece un beneficio sin % (2x1) por su carril, sin meterlo en el ranking ni traducirlo a porcentaje', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Freddo',
        discountPercentage: null,
        benefitLabel: '2x1 en helados de litro y cucuruchos grandes',
        branches: [branch(MONTEVIDEO_POINT, 'Freddo Pocitos', 'Pocitos')],
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(MONTEVIDEO_POINT),
    );

    const rec = await useCase.execute('Restaurantes', 'Pocitos');

    expect(rec.bestToday).toBeNull();
    expect(rec.alternatives).toEqual([]);
    expect(rec.otherBenefits).toEqual([
      {
        merchantChainName: 'Freddo',
        branchName: 'Freddo Pocitos',
        neighborhood: 'Pocitos',
        address: 'Freddo Pocitos',
        bankName: 'Itaú',
        label: '2x1 en helados de litro y cucuruchos grandes',
      },
    ]);
  });

  it('un beneficio sin % y sin local confirmado no se ofrece, igual que un descuento', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Freddo',
        discountPercentage: null,
        benefitLabel: '2x1 en helados',
        hasVerifiedBranch: false,
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null);

    expect(rec.otherBenefits).toEqual([]);
  });

  it('filtra los beneficios sin % por las tarjetas del usuario, igual que los descuentos', async () => {
    const prisma = buildPrisma(
      [
        row({
          merchantChainId: 'c1',
          merchantChainName: 'Freddo',
          discountPercentage: null,
          benefitLabel: '2x1 en helados',
          bank: { name: 'Itaú' },
        }),
        row({
          merchantChainId: 'c2',
          merchantChainName: 'Movie',
          discountPercentage: null,
          benefitLabel: '2x1 en entradas',
          bank: { name: 'OCA' },
        }),
      ],
      ['Itaú'],
    );
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null, 'user-itau');

    expect(rec.otherBenefits.map((b) => b.merchantChainName)).toEqual([
      'Freddo',
    ]);
  });

  it('un beneficio sin % no cuenta como "hay promos que no puedo confirmar" — no vuelve unverifiedOnly a la respuesta', async () => {
    const prisma = buildPrisma([
      row({
        merchantChainId: 'c1',
        merchantChainName: 'Freddo',
        discountPercentage: null,
        benefitLabel: '2x1 en helados',
        branches: [branch(MONTEVIDEO_POINT, 'Freddo Pocitos')],
      }),
    ]);
    const useCase = new BrowseByCategoryUseCase(
      prisma as never,
      fakeGeocoder(),
    );

    const rec = await useCase.execute('Restaurantes', null);

    expect(rec.nothingFound).toBe(true);
    expect(rec.unverifiedOnly).toBe(false);
    expect(rec.otherBenefits).toHaveLength(1);
  });
});
