import { PaymentType } from '../../../../generated/prisma/client';
import { OcaBenefitsScraper } from './oca-benefits.scraper';

const ALL_WEEK_DAYS = ['0', '1', '2', '3', '4', '5', '6'];

describe('OcaBenefitsScraper.normalize', () => {
  const scraper = new OcaBenefitsScraper();

  it('normalizes a simple flat-rate benefit valid every day', () => {
    const [promo] = scraper.normalize([
      {
        brand: 'Farmashop',
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms:
          '<p>10% de descuento pagando con tarjetas de crédito OCA. Tope: $1.500 por mes.</p>',
      },
    ]);

    expect(promo.merchantChainName).toBe('Farmashop');
    expect(promo.discountPercentage).toBe(10);
    expect(promo.paymentType).toBe(PaymentType.CREDITO);
    expect(promo.capAmount).toBe(1500);
    expect(promo.validFrom).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(promo.validUntil).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it('skips benefits that only apply on some days of the week (no day-of-week field in the MVP schema)', () => {
    const promos = scraper.normalize([
      {
        brand: 'TaTa',
        date_ini: '2026-07-01',
        date_end: '2026-09-30',
        days: ['0', '1', '2', '3', '4'],
        description_terms: '<p>20% de descuento de lunes a viernes.</p>',
      },
    ]);

    expect(promos).toHaveLength(0);
  });

  it('skips benefits with no parseable percentage instead of inventing one', () => {
    const promos = scraper.normalize([
      {
        brand: 'Día del niño',
        date_ini: '2026-08-10',
        date_end: '2026-08-16',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>Elegí tu regalo con tus Metros.</p>',
      },
    ]);

    expect(promos).toHaveLength(0);
  });

  it('toma el porcentaje del titular cuando la letra chica no lo dice (caso real: Burger King 10%, todos los días)', () => {
    const [promo] = scraper.normalize([
      {
        brand: 'Burger King',
        title_ben: '10% de dto.',
        date_ini: '2026-01-01',
        date_end: '2026-12-31',
        days: ALL_WEEK_DAYS,
        location: ['2', '10'],
        description_terms:
          '<p>Promoción válida todos los días en locales adheridos.</p>',
      },
    ]);

    expect(promo.merchantChainName).toBe('Burger King');
    expect(promo.discountPercentage).toBe(10);
  });

  it('la letra chica le gana al titular: es la que trae el tope junto al %', () => {
    const [promo] = scraper.normalize([
      {
        brand: 'Farmashop',
        title_ben: '20% de dto.',
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>10% de descuento. Tope: $1.500.</p>',
      },
    ]);

    expect(promo.discountPercentage).toBe(10);
    expect(promo.capAmount).toBe(1500);
  });

  it('saltea un beneficio que declara departamentos y no incluye Montevideo', () => {
    const promos = scraper.normalize([
      {
        brand: 'Parador de Maldonado',
        title_ben: '20% de dto.',
        date_ini: '2026-08-01',
        date_end: '2026-12-31',
        days: ALL_WEEK_DAYS,
        location: ['9'], // Maldonado
        description_terms: '<p>20% de descuento.</p>',
      },
    ]);

    expect(promos).toHaveLength(0);
  });

  it('no filtra por zona cuando el beneficio no declara departamentos — ausencia de dato no es un "no"', () => {
    const promos = scraper.normalize([
      {
        brand: 'Farmashop',
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>10% de descuento.</p>',
      },
    ]);

    expect(promos).toHaveLength(1);
  });

  it('skips entries with no brand/title', () => {
    const promos = scraper.normalize([
      {
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>10% de descuento.</p>',
      },
    ]);

    expect(promos).toHaveLength(0);
  });

  it('resolves categoryName for the unambiguous category uids (supermercado/gastronomia)', () => {
    const [promo] = scraper.normalize([
      {
        brand: 'Disco',
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>15% de descuento.</p>',
        category: [{ uid: 'blt20e24482691dc97e' }],
      },
    ]);

    expect(promo.categoryName).toBe('Supermercados');
  });

  it('leaves categoryName undefined for categories with no clean mapping (e.g. "salud" mixes farmacias with ópticas)', () => {
    const [promo] = scraper.normalize([
      {
        brand: 'Óptica Florida',
        date_ini: '2026-08-01',
        date_end: '2026-08-31',
        days: ALL_WEEK_DAYS,
        description_terms: '<p>10% de descuento.</p>',
        category: [{ uid: 'blt4877845fd4d38828' }],
      },
    ]);

    expect(promo.categoryName).toBeUndefined();
  });
});
