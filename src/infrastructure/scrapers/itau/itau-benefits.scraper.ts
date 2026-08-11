import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PaymentType } from '../../../../generated/prisma/client';
import { BankScraper } from '../../../domain/scraping/bank-scraper.port';
import { MvpCategoryName } from '../../../domain/scraping/mvp-category';
import { ScrapedPromotion } from '../../../domain/scraping/scraped-promotion';

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

function resolveCategoryName(text: string): MvpCategoryName | undefined {
  // El feed no tiene un campo de categoría. Solo inferimos cuando el propio
  // texto dice "farmacia" literal — no hay señal confiable de
  // Supermercados/Restaurantes acá, así que esos quedan sin auto-descubrir
  // (solo matchean si ya existen en el catálogo).
  return /farmacia/i.test(text) ? 'Farmacias' : undefined;
}

interface ParsedFeedItem {
  merchantName: string;
  titulo: string;
  descripcion: string;
}

@Injectable()
export class ItauBenefitsScraper implements BankScraper {
  readonly bankName = 'Itaú';
  private readonly logger = new Logger(ItauBenefitsScraper.name);

  async scrape(): Promise<ScrapedPromotion[]> {
    const xml = await this.fetchFeed();
    return this.parse(xml);
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

      const item = this.parseItem(tituloRaw, descripcionRaw);
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
      if (!percentMatch) {
        this.logger.debug(
          `Sin porcentaje detectable, salteo: ${item.merchantName}`,
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
        discountPercentage: Number(percentMatch[1]),
        paymentType: inferPaymentType(item.descripcion),
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
  ): ParsedFeedItem | null {
    const titulo = stripEmbeddedHtml(tituloRaw);
    const descripcion = stripEmbeddedHtml(descripcionRaw);

    const merchantMatch = titulo.match(MERCHANT_NAME_REGEX);
    if (!merchantMatch) return null;

    return { merchantName: merchantMatch[1].trim(), titulo, descripcion };
  }
}
