import { PaymentType } from '../../../../generated/prisma/client';
import { SantanderBenefitsScraper } from './santander-benefits.scraper';

function card(params: {
  id: string;
  title: string;
  copy: string;
  href: string;
}): string {
  return `
    <div class="node node--type-beneficios" data-history-node-id="${params.id}">
      <a href="${params.href}">
        <h3><span class="field--name-title">${params.title}</span></h3>
        <div class="field--name-body"><p>${params.copy}</p></div>
      </a>
    </div>
  `;
}

describe('SantanderBenefitsScraper.parse', () => {
  const scraper = new SantanderBenefitsScraper();

  it('extracts merchant, headline percentage and payment type from a simple card', () => {
    const html = card({
      id: '1',
      title: 'Farmashop',
      copy: '10% de descuento con tarjetas de crédito, todos los días.',
      href: '/beneficios/farmashop',
    });

    const [promo] = scraper.parse(html);

    expect(promo.merchantChainName).toBe('Farmashop');
    expect(promo.discountPercentage).toBe(10);
    expect(promo.paymentType).toBe(PaymentType.CREDITO);
    expect(promo.sourceUrl).toBe(
      'https://www.santander.com.uy/beneficios/farmashop',
    );
  });

  it('takes the first percentage when a card lists tiered discounts by card type', () => {
    const html = card({
      id: '2',
      title: 'Bruta',
      copy: '25% con Platinum, Select y Private Banking. 15% con crédito y débito.',
      href: '/beneficios/bruta',
    });

    const [promo] = scraper.parse(html);

    expect(promo.discountPercentage).toBe(25);
    expect(promo.paymentType).toBe(PaymentType.AMBOS);
  });

  it('skips cards with no detectable percentage instead of inventing one', () => {
    const html = card({
      id: '3',
      title: 'Devoto',
      copy: 'Descuento sujeto a promociones.',
      href: '/beneficios/devoto',
    });

    expect(scraper.parse(html)).toHaveLength(0);
  });

  it('deduplicates cards that repeat the same node id (card-grid + list-map widgets)', () => {
    const html = card({
      id: '4',
      title: 'Farmashop',
      copy: '10% de descuento todos los días.',
      href: '/beneficios/farmashop',
    }).repeat(2);

    expect(scraper.parse(html)).toHaveLength(1);
  });

  it('tags every promo with the category the caller passed (one fetch per category term id)', () => {
    const html = card({
      id: '5',
      title: 'La Pasiva',
      copy: '25% de descuento todos los días.',
      href: '/beneficios/la-pasiva',
    });

    const [promo] = scraper.parse(html, 'Restaurantes');

    expect(promo.categoryName).toBe('Restaurantes');
  });
});

/** Markup real de la pestaña "Locales" de una ficha, recortado. */
function branchArticle(
  name: string,
  address: string,
  latitude: string,
  longitude: string,
): string {
  return `<article class="node node--type-sitios-de-interes node--view-mode-teaser">
    <h3 class="h5"><span class="field field--name-title field--type-string">${name}</span></h3>
    <ul><li><div class="field field--name-field-ubicacion field--type-string field__item">${address}</div></li></ul>
    <a href="https://www.google.com/maps/dir//${latitude},${longitude}" target="_blank">Ir a la dirección</a>
  </article>`;
}

describe('SantanderBenefitsScraper.parseBranches', () => {
  const scraper = new SantanderBenefitsScraper();

  it('lee nombre, calle y coordenadas de cada local de la ficha', () => {
    const branches = scraper.parseBranches(
      branchArticle('Bardo', 'Coronel Mora 631', '-34.918649', '-56.1570611'),
    );

    expect(branches).toEqual([
      {
        name: 'Bardo',
        address: 'Coronel Mora 631',
        latitude: -34.918649,
        longitude: -56.1570611,
      },
    ]);
  });

  it('desambigua los locales repetidos con su calle (Santander los nombra a todos igual que la cadena)', () => {
    const branches = scraper.parseBranches(
      branchArticle(
        'Ramona',
        'San José 900 esq. Convención',
        '-34.907215',
        '-56.196938',
      ) +
        branchArticle(
          'Ramona',
          'Luis de la Torre 701 esq. Solano Antuña',
          '-34.913817',
          '-56.156274',
        ),
    );

    expect(branches.map((b) => b.name)).toEqual([
      'Ramona',
      'Ramona (Luis de la Torre 701 esq. Solano Antuña)',
    ]);
  });

  it('descarta los locales fuera de Montevideo (Ruta Gourmet llega a Punta del Este)', () => {
    const branches = scraper.parseBranches(
      branchArticle('La Huella', 'José Ignacio', '-34.8398', '-54.6285') +
        branchArticle('Bardo', 'Coronel Mora 631', '-34.918649', '-56.1570611'),
    );

    expect(branches.map((b) => b.name)).toEqual(['Bardo']);
  });

  it('ignora un local sin link de mapa: sin coordenadas no sirve para medir distancia', () => {
    const html = `<article class="node node--type-sitios-de-interes">
      <h3><span class="field field--name-title">Sin mapa</span></h3>
      <div class="field field--name-field-ubicacion">Alguna calle 123</div>
    </article>`;

    expect(scraper.parseBranches(html)).toEqual([]);
  });

  it('devuelve vacío cuando la ficha no lista locales', () => {
    expect(scraper.parseBranches('<html><body></body></html>')).toEqual([]);
  });
});

describe('SantanderBenefitsScraper.parseBranches — límite departamental', () => {
  const scraper = new SantanderBenefitsScraper();

  it('descarta un local del área metropolitana cuya dirección dice otro departamento', () => {
    // Real: Portal Américas queda a 15 km del centro (dentro del radio) pero
    // su dirección dice Canelones.
    const branches = scraper.parseBranches(
      branchArticle(
        'Concepto OM',
        'Portal Américas, Av. de las Américas 6000, 15000 Canelones, Departamento de Canelones',
        '-34.8352',
        '-56.0399',
      ) +
        branchArticle(
          'Concepto OM',
          'José Ellauri 350, 11300 Montevideo, Departamento de Montevideo',
          '-34.9234',
          '-56.1596',
        ),
    );

    expect(branches).toHaveLength(1);
    expect(branches[0].address).toContain('José Ellauri');
  });
});
