import { PaymentType } from '../../../../generated/prisma/client';
import { ItauBenefitsScraper } from './itau-benefits.scraper';

function feed(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<inicio>
  <fecha>20260811173306</fecha>
  <list_debito cant_list_debito="1">
    ${items}
  </list_debito>
</inicio>`;
}

function item(titulo: string, descripcion: string): string {
  return `<item final_item="false" grupo_item="false" id="benef_1" url="false">
    <titulo><![CDATA[${titulo}]]></titulo>
    <descripcion><![CDATA[${descripcion}]]></descripcion>
  </item>`;
}

/** Estructura real recortada de restaurantes.html (Astro, HTML estático). */
function restaurantsPage(options?: {
  percentText?: string;
  mvd?: string[];
  pde?: string[];
}): string {
  const card = (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<a id="restaurant-${slug}" title="${name}" href="#"><img alt="${name}" src="x.webp"></a>`;
  };
  const { percentText = '15% menos', mvd = [], pde = [] } = options ?? {};
  return `<html><body>
    <h1>${percentText}</h1>
    <p>Todos los días, con tarjetas débito Volar y todas las tarjetas de crédito Itaú de Uruguay.</p>
    <section id="tab-mvd"><h2>Restaurantes</h2>${mvd.map(card).join('')}
      <h2>Tiendas Gourmet</h2><a id="gourmet-almacen" title="Almacén"><img alt="Almacén"></a>
    </section>
    <section class="hidden" id="tab-pde"><h2>Restaurantes</h2>${pde.map(card).join('')}</section>
  </body></html>`;
}

describe('ItauBenefitsScraper.parseRestaurants', () => {
  const scraper = new ItauBenefitsScraper();

  it('lee los restaurantes de la solapa Montevideo con el descuento que anuncia la página', () => {
    const promos = scraper.parseRestaurants(
      restaurantsPage({ mvd: ['La Cocina de Pedro', 'Café Haus'] }),
    );

    expect(promos).toHaveLength(2);
    expect(promos[0]).toMatchObject({
      merchantChainName: 'La Cocina de Pedro',
      categoryName: 'Restaurantes',
      discountPercentage: 15,
      paymentType: PaymentType.AMBOS,
      sourceUrl: 'https://www.itau.com.uy/inst/restaurantes.html',
    });
  });

  it('ignora las otras solapas — la clasificación por zona la hace el propio banco', () => {
    // Caso real: Itaú lista 78 restaurantes en Montevideo y 72 en Punta del
    // Este; mezclar las solapas repetiría el bug de Soho a gran escala.
    const promos = scraper.parseRestaurants(
      restaurantsPage({ mvd: ['Eladio'], pde: ['La Huella', 'Ovo Beach'] }),
    );

    expect(promos.map((p) => p.merchantChainName)).toEqual(['Eladio']);
  });

  it('ignora las secciones que no son Restaurantes (tiendas gourmet, librerías)', () => {
    const promos = scraper.parseRestaurants(restaurantsPage({ mvd: ['Baco'] }));

    expect(promos.map((p) => p.merchantChainName)).toEqual(['Baco']);
  });

  it('no ingiere nada si la página dejó de decir el descuento, en vez de inventarlo', () => {
    const promos = scraper.parseRestaurants(
      restaurantsPage({ percentText: 'Descuentos especiales', mvd: ['Baco'] }),
    );

    expect(promos).toEqual([]);
  });

  it('no repite un comercio que aparece dos veces en la misma solapa', () => {
    const promos = scraper.parseRestaurants(
      restaurantsPage({ mvd: ['Café Misterio', 'Café Misterio'] }),
    );

    expect(promos).toHaveLength(1);
  });
});

describe('ItauBenefitsScraper.parse', () => {
  const scraper = new ItauBenefitsScraper();

  it('extracts merchant, percentage and payment type from a clean item', () => {
    const xml = feed(
      item(
        '15% menos en Cantegrill Joyas',
        '15% menos en Cantegrill Joyas pagando con tarjetas de crédito Itaú.',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.merchantChainName).toBe('Cantegrill Joyas');
    expect(promo.discountPercentage).toBe(15);
    expect(promo.paymentType).toBe(PaymentType.CREDITO);
    expect(promo.sourceUrl).toBe(
      'https://www.itau.com.uy/inst/aci/inst_camp.xml',
    );
  });

  it('handles "y N cuotas" titles (Bridgestone-style)', () => {
    const xml = feed(
      item(
        '20% menos y 6 cuotas en Bridgestone',
        '20% menos en Bridgestone pagando con tarjetas de crédito Itaú.',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.merchantChainName).toBe('Bridgestone');
    expect(promo.discountPercentage).toBe(20);
  });

  it('skips a campaign whose validity date has already passed (real 2019 case found in the feed)', () => {
    const xml = feed(
      item(
        '15% menos en restaurantes',
        '25% menos en restaurantes pagando con tarjetas de crédito Itaú del el 1° de julio al 15 de agosto de 2019.',
      ),
    );

    expect(scraper.parse(xml)).toHaveLength(0);
  });

  it('keeps a campaign with a future/current-year end date', () => {
    const xml = feed(
      item(
        '15% menos en Ejemplo Vigente',
        '15% menos en Ejemplo Vigente con tarjetas Itaú hasta el 31 de diciembre de 2026.',
      ),
    );

    expect(scraper.parse(xml)).toHaveLength(1);
  });

  it('strips HTML/CSS pasted from Word inside the CDATA instead of matching junk percentages (real Wikimusculos case: "line-height:107%")', () => {
    const xml = feed(
      item(
        '15% menos en Wikimusculos',
        '<p class="MsoNormal"><strong><span style="font-size:15.0pt;line-height:107%;font-family:&quot;Arial&quot;">15% menos en Wikimusculos con tarjetas de crédito y débito Itaú Volar.</span></strong></p>',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.merchantChainName).toBe('Wikimusculos');
    expect(promo.discountPercentage).toBe(15);
  });

  it('tags categoryName Farmacias only when the text literally says "farmacia"', () => {
    const xml = feed(
      item(
        '25% y 15% menos en Farmacia El Túnel',
        '25% menos en farmacias El Túnel los días lunes y miércoles con tarjetas Platinum.',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.categoryName).toBe('Farmacias');
  });

  it('leaves categoryName undefined for merchants with no category hint (e.g. Bridgestone)', () => {
    const xml = feed(
      item(
        '15% menos en Bosch y Cia',
        '15% menos en Bosch y Cia con tarjetas Itaú.',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.categoryName).toBeUndefined();
  });

  it('infiere Restaurantes cuando el texto del banco nombra el rubro de comida', () => {
    const xml = feed(
      `<item id="benef_1">
        <titulo><![CDATA[2x1 en Freddo]]></titulo>
        <descripcion><![CDATA[2x1 en helados de kilo y cucuruchos grandes con tarjetas de débito Volar.]]></descripcion>
      </item>`,
    );

    expect(scraper.parse(xml)[0].categoryName).toBe('Restaurantes');
  });

  it('no infiere categoría por el nombre del comercio (Le Blanc suena a panadería y es una tienda de blancos)', () => {
    const xml = feed(
      item(
        '25% menos en Le Blanc',
        '25% menos en Le Blanc con tarjetas de crédito Itaú.',
      ),
    );

    expect(scraper.parse(xml)[0].categoryName).toBeUndefined();
  });

  it('guarda un 2x1 como beneficio con texto, sin inventarle un porcentaje', () => {
    // Freddo y Las Delicias, las únicas promos gastronómicas que Itaú tiene
    // hoy en Montevideo, son 2x1: descartarlas dejaba a un usuario Itaú sin
    // ninguna opción para comer.
    const xml = feed(
      item('2x1 en Movie', '2x1 en Movie pagando con tarjeta de débito Volar.'),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.merchantChainName).toBe('Movie');
    expect(promo.discountPercentage).toBeUndefined();
    expect(promo.benefitLabel).toBe('2x1');
  });

  it('usa el <detalle> del banco como texto del beneficio cuando lo trae', () => {
    // Estructura real del feed: detalle y mapa cuelgan de <final_item>, no
    // del <item> (por eso el selector no puede ser de hijo directo).
    const xml = feed(
      `<item id="benef_1">
        <titulo><![CDATA[2x1 en Freddo]]></titulo>
        <descripcion><![CDATA[2x1 en helados con tarjetas de débito Volar.]]></descripcion>
        <final_item id="final_1">
          <detalle><![CDATA[2x1 en helados de litro y cucuruchos grandes]]></detalle>
        </final_item>
      </item>`,
    );

    const [promo] = scraper.parse(xml);

    expect(promo.benefitLabel).toBe(
      '2x1 en helados de litro y cucuruchos grandes',
    );
  });

  it('el porcentaje le gana al texto cuando el ítem tiene los dos', () => {
    const xml = feed(
      item(
        '25% menos en Mosca',
        '25% menos en Mosca con tarjetas de crédito Itaú.',
      ),
    );

    const [promo] = scraper.parse(xml);

    expect(promo.discountPercentage).toBe(25);
    expect(promo.benefitLabel).toBeUndefined();
  });

  it('sigue salteando un ítem que no es ni % ni beneficio reconocible', () => {
    const xml = feed(
      item('Beneficios en hoteles', 'Consultá las bases y condiciones.'),
    );

    expect(scraper.parse(xml)).toHaveLength(0);
  });

  it('skips items with no title/description at all (PDF-only campaigns)', () => {
    const xml = feed(
      `<item final_item="false" grupo_item="false" id="benef_2" url="true">
        <titulo><![CDATA[25% menos todos los días ]]></titulo>
        <descripcion/>
        <url>https://www.itau.com.uy/inst/aci/docs/algo.pdf</url>
      </item>`,
    );

    expect(scraper.parse(xml)).toHaveLength(0);
  });

  it('lee los locales del <mapa> con sus coordenadas — el banco ya nos dice dónde queda', () => {
    // Ítem real del feed, recortado: Freddo publica 5 locales con lat/long.
    const xml = feed(
      `<item id="benef_1">
        <titulo><![CDATA[25% menos en Freddo]]></titulo>
        <descripcion><![CDATA[25% menos en Freddo con tarjetas de crédito Itaú.]]></descripcion>
        <mapa>
          <mapa_comercio>
            <nombre>Freddo Pocitos</nombre>
            <latitud>-34.9160504951348</latitud>
            <longitud>-56.15886926651</longitud>
          </mapa_comercio>
          <mapa_comercio>
            <nombre>Freddo Carrasco</nombre>
            <latitud>-34.8885711329565</latitud>
            <longitud>-56.0583078861237</longitud>
          </mapa_comercio>
        </mapa>
      </item>`,
    );

    const [promo] = scraper.parse(xml);

    expect(promo.branches).toEqual([
      {
        name: 'Freddo Pocitos',
        latitude: -34.9160504951348,
        longitude: -56.15886926651,
      },
      {
        name: 'Freddo Carrasco',
        latitude: -34.8885711329565,
        longitude: -56.0583078861237,
      },
    ]);
  });

  it('descarta los locales fuera de Montevideo (caso real: el único "Soho" del feed es Soho Deco, en Punta del Este)', () => {
    const xml = feed(
      `<item id="benef_1">
        <titulo><![CDATA[25% y 15% menos en Soho]]></titulo>
        <descripcion><![CDATA[25% menos en Soho con tarjetas de crédito Itaú.]]></descripcion>
        <mapa>
          <mapa_comercio>
            <nombre>Soho Deco</nombre>
            <latitud>-34.94782331090158</latitud>
            <longitud>-54.93367373943329</longitud>
          </mapa_comercio>
        </mapa>
      </item>`,
    );

    const [promo] = scraper.parse(xml);

    // La promo existe (es real), pero sin local en Montevideo no se recomienda.
    expect(promo.merchantChainName).toBe('Soho');
    expect(promo.branches).toEqual([]);
  });

  it('ignora un mapa_comercio sin nombre o con coordenadas rotas en vez de guardar basura', () => {
    const xml = feed(
      `<item id="benef_1">
        <titulo><![CDATA[25% menos en Le Blanc]]></titulo>
        <descripcion><![CDATA[25% menos en Le Blanc con tarjetas de crédito Itaú.]]></descripcion>
        <mapa>
          <mapa_comercio>
            <nombre></nombre>
            <latitud>-34.90</latitud>
            <longitud>-56.13</longitud>
          </mapa_comercio>
          <mapa_comercio>
            <nombre>Le Blanc</nombre>
            <latitud>N/D</latitud>
            <longitud>-56.13</longitud>
          </mapa_comercio>
        </mapa>
      </item>`,
    );

    const [promo] = scraper.parse(xml);

    expect(promo.branches).toEqual([]);
  });

  it('deja branches vacío cuando el ítem no trae mapa', () => {
    const xml = feed(
      item('25% menos en Mosca', '25% menos en Mosca con tarjetas Platinum.'),
    );

    expect(scraper.parse(xml)[0].branches).toEqual([]);
  });

  it('deduplicates repeated entries for the same merchant, keeping the first', () => {
    const xml = feed(
      item('25% menos en Mosca', '25% menos en Mosca con tarjetas Platinum.') +
        item('10% menos en Mosca', '10% menos en Mosca con tarjeta de débito.'),
    );

    const promos = scraper.parse(xml);

    expect(promos).toHaveLength(1);
    expect(promos[0].discountPercentage).toBe(25);
  });
});
