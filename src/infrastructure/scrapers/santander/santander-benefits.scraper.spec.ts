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
