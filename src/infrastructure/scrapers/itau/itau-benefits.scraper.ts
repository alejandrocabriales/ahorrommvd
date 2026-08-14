import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { PaymentType } from '../../../../generated/prisma/client';
import { isInMontevideoArea } from '../../../domain/geocoding/montevideo-area';
import { BankScraper } from '../../../domain/scraping/bank-scraper.port';
import { MvpCategoryName } from '../../../domain/scraping/mvp-category';
import {
  ScrapedBranch,
  ScrapedPromotion,
} from '../../../domain/scraping/scraped-promotion';

/**
 * beneficios.html es una SPA React sin API descubrible por análisis estático
 * (bloqueante real de Semana 2). Pero el sitio también sirve un feed XML
 * viejo, de un sistema de campañas anterior a la SPA actual, que sigue
 * activo y con contenido real:
 *
 *   https://www.itau.com.uy/inst/aci/inst_camp.xml
 *
 * Encontrado inspeccionando los pedidos de red reales con Playwright
 * (headless, corrido localmente — no hace falta en producción, esto es
 * un GET simple). Mezcla campañas vigentes con campañas viejas sin sacar
 * (encontramos una vencida en 2019 y otra en 2022) — hay que filtrar por
 * fecha, no asumir que todo lo que aparece está vigente.
 */
const FEED_URL = 'https://www.itau.com.uy/inst/aci/inst_camp.xml';

/**
 * El grueso de los restaurantes de Itaú NO está en el feed: está en esta
 * landing, y el feed la referencia (el ítem "15% menos en restaurantes"
 * trae `<url>` apuntando acá). Ese ítem se saltea por vencido —su
 * descripción quedó pegada en una campaña de 2019— y con él se perdían 78
 * restaurantes de Montevideo, incluido el caso que reportó el usuario ("La
 * Cocina de Pedro", Barrio Sur).
 *
 * Es HTML estático (Astro), sin API: los comercios vienen como
 * `id="restaurant-<slug>" title="<nombre>"`, agrupados en tres solapas
 * —`#tab-mvd`, `#tab-pde`, `#tab-interior`— que son la propia clasificación
 * por zona del banco. Solo leemos la de Montevideo: es una fuente de zona
 * mejor que cualquier heurística nuestra.
 */
const RESTAURANTS_URL = 'https://www.itau.com.uy/inst/restaurantes.html';
const MONTEVIDEO_TAB_SELECTOR = '#tab-mvd';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Igual que Santander: el feed no da fecha de fin para los beneficios
// vigentes (las únicas fechas explícitas que trae son de campañas ya
// vencidas). Ventana rodante, refrescada por el cron diario.
const ROLLING_WINDOW_DAYS = 30;

// "15% menos en X", "25% y 15% menos en X", "20% menos y 6 cuotas en X".
const MERCHANT_NAME_REGEX =
  /^\s*\d{1,2}\s*%\s*(?:y\s*\d{1,2}\s*%\s*)?menos\s*(?:y\s*\d+\s*cuotas\s*)?en\s+(.+?)\s*$/i;
const PERCENT_REGEX = /(\d{1,2})\s*%/;
// El titular de restaurantes.html: "15% menos". Pedimos la palabra "menos"
// para no agarrar cualquier número con % de la letra chica (topes, IVA).
const PERCENT_LESS_REGEX = /(\d{1,2})\s*%\s*menos/i;
// "2x1 en Freddo", "3x2 en X" — beneficio real sin porcentaje. Son las
// únicas promos gastronómicas que Itaú tiene hoy en Montevideo (Freddo y
// Las Delicias), y descartarlas por no traer % era la razón de que un
// usuario Itaú preguntando dónde comer no recibiera nada.
const LABELED_TITLE_REGEX = /^\s*(\d\s*x\s*\d)\s+en\s+(.+?)\s*$/i;
// "hasta el 31 de diciembre de 2022", "al 15 de agosto de 2019" -> si el año
// ya pasó, la campaña está muerta aunque el feed la siga sirviendo.
const STALE_DATE_REGEX =
  /(?:hasta|al)\s+(?:el\s+)?\d{1,2}[°º]?\s+de\s+\w+\s+de\s+(\d{4})/i;

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

// El CDATA de <descripcion> a veces trae HTML pegado de Word (spans con
// `style="line-height:107%"` y similares) como texto literal, no como
// markup real — sin este paso, el regex de porcentaje agarra basura del
// CSS (ej. "07" de "line-height:107%") en vez del descuento real.
function stripEmbeddedHtml(text: string): string {
  return cheerio.load(text).text().replace(/\s+/g, ' ').trim();
}

function inferPaymentType(text: string): PaymentType {
  const hasCredito = /cr[ée]dito/i.test(text);
  const hasDebito = /d[ée]bito/i.test(text);
  if (hasCredito && !hasDebito) return PaymentType.CREDITO;
  if (hasDebito && !hasCredito) return PaymentType.DEBITO;
  return PaymentType.AMBOS;
}

/**
 * El feed no tiene campo de categoría, así que la inferimos solo cuando el
 * texto del propio banco nombra el rubro. Nada de deducir por el nombre del
 * comercio: "Le Blanc" suena a panadería y es una tienda de blancos (probado
 * contra Places: `store`), "Masinfinito" suena a café y es `furniture_store`.
 *
 * Las palabras de comida están porque los únicos beneficios gastronómicos de
 * Itaú en Montevideo son heladerías (Freddo, Las Delicias) y sin esto no se
 * auto-descubren: quedan sin cadena y se pierden enteros.
 */
const CATEGORY_KEYWORDS: Array<[MvpCategoryName, RegExp]> = [
  ['Farmacias', /farmacia/i],
  [
    'Restaurantes',
    /helad|cucurucho|cafeter[ií]a|confiter[ií]a|panader[ií]a|pizzer[ií]a|restaurante|sushi|hamburgues/i,
  ],
  ['Supermercados', /supermercado|autoservicio/i],
];

function resolveCategoryName(text: string): MvpCategoryName | undefined {
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0];
}

interface ParsedFeedItem {
  merchantName: string;
  titulo: string;
  descripcion: string;
  /** Solo para beneficios sin %: el texto que le vamos a mostrar al usuario. */
  benefitLabel?: string;
}

/**
 * Cada `<item>` puede traer un `<mapa>` con los locales de la promo:
 * `<mapa_comercio>` con nombre, latitud y longitud. Es el dato que faltaba
 * para no tener que adivinar dónde queda un comercio — y el que hubiera
 * evitado el bug de Soho: el feed dice que el único local es "Soho Deco" en
 * (-34.9478, -54.9336), o sea Punta del Este, no Montevideo.
 *
 * Los locales fuera de Montevideo se descartan acá mismo: la promo sigue
 * siendo válida, pero sin local en Montevideo no se la vamos a recomendar a
 * nadie (spec: "Zona: Montevideo únicamente").
 */
function parseBranches($: cheerio.CheerioAPI, item: AnyNode): ScrapedBranch[] {
  const branches: ScrapedBranch[] = [];
  $(item)
    .find('mapa_comercio')
    .each((_i, el) => {
      const name = $(el).find('> nombre').first().text().trim();
      const latitude = Number($(el).find('> latitud').first().text().trim());
      const longitude = Number($(el).find('> longitud').first().text().trim());
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }
      if (!isInMontevideoArea({ latitude, longitude })) return;
      branches.push({ name, latitude, longitude });
    });
  return branches;
}

@Injectable()
export class ItauBenefitsScraper implements BankScraper {
  readonly bankName = 'Itaú';
  private readonly logger = new Logger(ItauBenefitsScraper.name);

  async scrape(): Promise<ScrapedPromotion[]> {
    const fromFeed = this.parse(await this.fetchFeed());

    // La landing es la fuente del grueso de los restaurantes, pero es una
    // página más frágil que el feed (HTML generado, sin contrato): si se
    // cae o cambia de estructura, devolvemos igual lo del feed en vez de
    // dejar al banco entero sin promos.
    let fromLanding: ScrapedPromotion[] = [];
    try {
      fromLanding = this.parseRestaurants(await this.fetchRestaurants());
    } catch (err) {
      this.logger.error(`No pude leer ${RESTAURANTS_URL}: ${err}`);
    }

    // El feed manda ante un mismo comercio: trae sucursales con
    // coordenadas, la landing solo el nombre.
    const seen = new Set(
      fromFeed.map((p) => p.merchantChainName.toLowerCase()),
    );
    return [
      ...fromFeed,
      ...fromLanding.filter(
        (p) => !seen.has(p.merchantChainName.toLowerCase()),
      ),
    ];
  }

  /**
   * Los restaurantes de la solapa Montevideo, todos con el mismo descuento
   * que anuncia la página. No inventamos el porcentaje: se lee del texto
   * ("15% menos") y si no aparece, no devolvemos nada.
   */
  parseRestaurants(html: string): ScrapedPromotion[] {
    const $ = cheerio.load(html);
    const today = new Date();

    const percentMatch = $('body').text().match(PERCENT_LESS_REGEX);
    if (!percentMatch) {
      this.logger.error(
        `${RESTAURANTS_URL} ya no dice el descuento ("N% menos") — no ingiero nada antes que inventarlo`,
      );
      return [];
    }

    const promotions: ScrapedPromotion[] = [];
    const seen = new Set<string>();
    $(`${MONTEVIDEO_TAB_SELECTOR} [id^="restaurant-"]`).each((_i, el) => {
      const name = ($(el).attr('title') ?? $(el).find('img').attr('alt') ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());

      promotions.push({
        merchantChainName: name,
        categoryName: 'Restaurantes',
        discountPercentage: Number(percentMatch[1]),
        // "con tarjetas débito Volar y todas las tarjetas de crédito Itaú".
        paymentType: PaymentType.AMBOS,
        validFrom: startOfDay(today),
        validUntil: endOfDay(addDays(today, ROLLING_WINDOW_DAYS)),
        sourceUrl: RESTAURANTS_URL,
      });
    });

    return promotions;
  }

  private async fetchRestaurants(): Promise<string> {
    const response = await fetch(RESTAURANTS_URL, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(
        `Itaú restaurantes.html respondió ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  private async fetchFeed(): Promise<string> {
    const response = await fetch(FEED_URL, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(
        `Itaú inst_camp.xml respondió ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  parse(xml: string): ScrapedPromotion[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const today = new Date();
    const currentYear = today.getFullYear();
    const byMerchant = new Map<string, ScrapedPromotion>();

    $('item').each((_i, el) => {
      const tituloRaw = $(el).find('> titulo').first().text().trim();
      const descripcionRaw = $(el).find('> descripcion').first().text().trim();
      if (!tituloRaw || !descripcionRaw) return; // ítems solo-PDF, sin datos inline

      // `detalle` y `mapa` cuelgan de `<final_item>`, no del `<item>` — por
      // eso acá no va el selector de hijo directo que sí usan titulo y
      // descripcion.
      const detalleRaw = $(el).find('detalle').first().text().trim();
      const item = this.parseItem(tituloRaw, descripcionRaw, detalleRaw);
      if (!item) return;

      const staleMatch = item.descripcion.match(STALE_DATE_REGEX);
      if (staleMatch && Number(staleMatch[1]) < currentYear) {
        this.logger.debug(
          `Salteo "${item.merchantName}": campaña vencida (${staleMatch[1]})`,
        );
        return;
      }

      const percentMatch =
        item.descripcion.match(PERCENT_REGEX) ||
        item.titulo.match(PERCENT_REGEX);
      if (!percentMatch && !item.benefitLabel) {
        this.logger.debug(
          `Sin porcentaje ni beneficio reconocible, salteo: ${item.merchantName}`,
        );
        return;
      }

      // El feed repite el mismo comercio varias veces (distintas listas de
      // tarjeta) — nos quedamos con el primero, mismo criterio que Santander
      // con duplicados de node id.
      if (byMerchant.has(item.merchantName)) return;

      byMerchant.set(item.merchantName, {
        merchantChainName: item.merchantName,
        categoryName: resolveCategoryName(`${item.titulo} ${item.descripcion}`),
        // Un ítem con % gana al label: el porcentaje es comparable, el texto
        // no. Solo queda el label cuando no hay % en ningún lado.
        ...(percentMatch
          ? { discountPercentage: Number(percentMatch[1]) }
          : { benefitLabel: item.benefitLabel }),
        paymentType: inferPaymentType(item.descripcion),
        branches: parseBranches($, el),
        validFrom: startOfDay(today),
        validUntil: endOfDay(addDays(today, ROLLING_WINDOW_DAYS)),
        sourceUrl: FEED_URL,
      });
    });

    return [...byMerchant.values()];
  }

  private parseItem(
    tituloRaw: string,
    descripcionRaw: string,
    detalleRaw = '',
  ): ParsedFeedItem | null {
    const titulo = stripEmbeddedHtml(tituloRaw);
    const descripcion = stripEmbeddedHtml(descripcionRaw);
    const detalle = stripEmbeddedHtml(detalleRaw);

    const merchantMatch = titulo.match(MERCHANT_NAME_REGEX);
    if (merchantMatch) {
      return { merchantName: merchantMatch[1].trim(), titulo, descripcion };
    }

    // "2x1 en Freddo": el comercio está igual de claro, lo que no hay es un
    // porcentaje. El label sale del <detalle> del banco si lo trae ("2x1 en
    // helados de litro y cucuruchos grandes") y si no, del título.
    const labeledMatch = titulo.match(LABELED_TITLE_REGEX);
    if (labeledMatch) {
      return {
        merchantName: labeledMatch[2].trim(),
        titulo,
        descripcion,
        benefitLabel:
          detalle || labeledMatch[1].replace(/\s+/g, '').toLowerCase(),
      };
    }

    return null;
  }
}
