import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PaymentType } from '../../../../generated/prisma/client';
import { BankScraper } from '../../../domain/scraping/bank-scraper.port';
import { MvpCategoryName } from '../../../domain/scraping/mvp-category';
import { isInMontevideoArea } from '../../../domain/geocoding/montevideo-area';
import {
  ScrapedBranch,
  ScrapedPromotion,
} from '../../../domain/scraping/scraped-promotion';

const LISTING_URL = 'https://www.santander.com.uy/beneficios';
const BASE_URL = 'https://www.santander.com.uy';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// El sitio no publica fecha de fin para la mayoría de los beneficios ("todos
// los días"); tratamos cada corrida como una foto de "vigente ahora" y le
// damos una ventana rodante, total dependemos del cron diario para refrescar.
const ROLLING_WINDOW_DAYS = 30;

// Fichas de comercio pedidas en paralelo. 6 mantiene la corrida en menos de
// medio minuto sin castigar al sitio del banco.
const DETAIL_CONCURRENCY = 6;

// "Departamento de Canelones" y compañía: si la dirección nombra un
// departamento que no es Montevideo, el local no nos sirve por más cerca que
// esté en línea recta.
const OTHER_DEPARTMENT_REGEX = /Departamento de (?!Montevideo)/i;

/**
 * El listado tiene un filtro por categoría (taxonomy Drupal) que se puede
 * pasar como query param `categoria[ID]=ID` y el servidor devuelve solo esos
 * comercios — confirmado pidiendo cada id por separado. Los ids salen del
 * facet de filtros expuesto en la página (`div#taxonomy-term-{id}` con el
 * nombre en un <span>). Solo nos importan las 3 categorías del MVP; el resto
 * (Moda, Tecnología, Viajes...) ni se pide.
 *
 * "Ruta Gourmet" es la categoría de Santander para gastronomía/restaurantes
 * (129 comercios reales al momento de escribir esto) — no hay una categoría
 * llamada literalmente "Restaurantes", pero el contenido es exactamente eso.
 */
const CATEGORY_TERM_IDS: Record<MvpCategoryName, string> = {
  Supermercados: '21',
  Farmacias: '23',
  Restaurantes: '22',
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function inferPaymentType(copy: string): PaymentType {
  const hasCredito = /cr[ée]dito/i.test(copy);
  const hasDebito = /d[ée]bito/i.test(copy);
  if (hasCredito && !hasDebito) return PaymentType.CREDITO;
  if (hasDebito && !hasCredito) return PaymentType.DEBITO;
  return PaymentType.AMBOS;
}

/**
 * Santander Uruguay sirve /beneficios como una vista Drupal renderizada en
 * el servidor: filtrando por categoría, todos los comercios de esa
 * categoría ya vienen completos en el HTML de esa carga (sin paginar, sin
 * browser headless).
 */
@Injectable()
export class SantanderBenefitsScraper implements BankScraper {
  readonly bankName = 'Santander';
  private readonly logger = new Logger(SantanderBenefitsScraper.name);

  async scrape(): Promise<ScrapedPromotion[]> {
    const byUrl = new Map<string, ScrapedPromotion>();

    for (const categoryName of Object.keys(
      CATEGORY_TERM_IDS,
    ) as MvpCategoryName[]) {
      const html = await this.fetchCategoryHtml(categoryName);
      for (const promo of this.parse(html, categoryName)) {
        if (!byUrl.has(promo.sourceUrl)) byUrl.set(promo.sourceUrl, promo);
      }
    }

    const promotions = [...byUrl.values()];
    await this.attachBranches(promotions);
    return promotions;
  }

  /**
   * La ficha de cada comercio (`/beneficios/<slug>`) tiene una pestaña
   * "Locales" con nombre, calle y un link a Google Maps con las coordenadas
   * exactas. Es el mismo dato que el backfill de Places intenta adivinar
   * por nombre, pero dicho por el banco que paga el descuento — y para 81
   * de los 125 restaurantes de Santander, Places no lo encontraba.
   *
   * Es una petición por comercio, así que van de a tandas: en serie son un
   * par de minutos, y este scraper corre dentro del cron diario.
   */
  private async attachBranches(promotions: ScrapedPromotion[]): Promise<void> {
    const withDetail = promotions.filter((p) =>
      p.sourceUrl.startsWith(`${BASE_URL}/beneficios/`),
    );

    for (let i = 0; i < withDetail.length; i += DETAIL_CONCURRENCY) {
      await Promise.all(
        withDetail.slice(i, i + DETAIL_CONCURRENCY).map(async (promo) => {
          try {
            const response = await fetch(promo.sourceUrl, {
              headers: { 'User-Agent': USER_AGENT },
            });
            if (!response.ok) {
              throw new Error(`${response.status} ${response.statusText}`);
            }
            promo.branches = this.parseBranches(await response.text());
          } catch (err) {
            // Una ficha caída no puede costar la promo entera: sin
            // sucursales, la cadena sigue el camino de siempre (backfill de
            // Places).
            this.logger.warn(
              `No pude leer los locales de ${promo.merchantChainName}: ${err}`,
            );
          }
        }),
      );
    }
  }

  /**
   * Los locales de una ficha. Se descartan los de fuera de Montevideo
   * (Ruta Gourmet incluye Punta del Este y Colonia) y se desambiguan los
   * nombres repetidos: Santander llama a todos los locales igual que a la
   * cadena ("Ramona", "Ramona"), y el unique de `Branch` es cadena+nombre,
   * así que sin esto el segundo local pisaría al primero.
   */
  parseBranches(html: string): ScrapedBranch[] {
    const $ = cheerio.load(html);
    const branches: ScrapedBranch[] = [];
    const seenNames = new Map<string, number>();

    $('article.node--type-sitios-de-interes').each((_i, el) => {
      const name = $(el).find('.field--name-title').first().text().trim();
      const address = $(el)
        .find('.field--name-field-ubicacion')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const href = $(el).find('a[href*="/maps/dir//"]').first().attr('href');
      const coords = href?.match(/\/maps\/dir\/\/(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!name || !coords) return;

      const latitude = Number(coords[1]);
      const longitude = Number(coords[2]);
      if (!isInMontevideoArea({ latitude, longitude })) return;
      // El radio de 25 km se come parte del área metropolitana: Portal
      // Américas figura a 15 km del centro pero su dirección dice
      // "Departamento de Canelones". Cuando la dirección nombra el
      // departamento, le creemos a ella antes que a la distancia.
      if (OTHER_DEPARTMENT_REGEX.test(address)) return;

      const repeats = seenNames.get(name) ?? 0;
      seenNames.set(name, repeats + 1);

      branches.push({
        name: repeats === 0 || !address ? name : `${name} (${address})`,
        address: address || undefined,
        latitude,
        longitude,
      });
    });

    return branches;
  }

  private async fetchCategoryHtml(
    categoryName: MvpCategoryName,
  ): Promise<string> {
    const termId = CATEGORY_TERM_IDS[categoryName];
    const url = new URL(LISTING_URL);
    url.searchParams.set(`categoria[${termId}]`, termId);

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(
        `Santander benefits page (${categoryName}) respondió ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  parse(html: string, categoryName?: MvpCategoryName): ScrapedPromotion[] {
    const $ = cheerio.load(html);
    const seenIds = new Set<string>();
    const promotions: ScrapedPromotion[] = [];
    const today = new Date();

    $('.node--type-beneficios[data-history-node-id]').each((_i, el) => {
      const id = $(el).attr('data-history-node-id');
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);

      const title = $(el).find('.field--name-title').first().text().trim();
      const copy = $(el)
        .find('.field--name-body')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const href = $(el).find('a[href^="/beneficios/"]').first().attr('href');

      if (!title || !copy) return;

      const percentMatch = copy.match(/(\d{1,2})\s*%/);
      if (!percentMatch) {
        this.logger.debug(`Sin porcentaje detectable, salteo: ${title}`);
        return;
      }

      promotions.push({
        merchantChainName: title,
        categoryName,
        discountPercentage: Number(percentMatch[1]),
        paymentType: inferPaymentType(copy),
        validFrom: startOfDay(today),
        validUntil: endOfDay(addDays(today, ROLLING_WINDOW_DAYS)),
        sourceUrl: href ? `${BASE_URL}${href}` : LISTING_URL,
      });
    });

    return promotions;
  }
}
