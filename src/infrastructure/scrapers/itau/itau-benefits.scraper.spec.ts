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

  it('skips items with no parseable percentage instead of inventing one (e.g. "2x1" campaigns)', () => {
    const xml = feed(
      item('2x1 en Movie', '2x1 en Movie pagando con tarjeta de débito Volar.'),
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
