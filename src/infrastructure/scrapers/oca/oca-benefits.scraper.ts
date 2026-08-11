import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PaymentType } from '../../../../generated/prisma/client';
import { BankScraper } from '../../../domain/scraping/bank-scraper.port';
import { MvpCategoryName } from '../../../domain/scraping/mvp-category';
import { ScrapedPromotion } from '../../../domain/scraping/scraped-promotion';

/**
 * OCA no tiene una API propia documentada: su frontend (oca.uy) trae los
 * beneficios desde Contentstack (CMS headless) usando estas credenciales de
 * *Content Delivery API*, visibles en texto plano en
 * https://oca.uy/src/js/get-data-beneficios.js. Son tokens de solo lectura
 * pensados para llamarse desde el browser — pegarles directo nos ahorra un
 * browser headless y nos da datos estructurados en vez de HTML para parsear.
 */
const CONTENTSTACK_URL =
  'https://cdn.contentstack.io/v3/content_types/marketing_benefits_page/entries?environment=produccion&include[]=benefits';
const CONTENTSTACK_HEADERS = {
  api_key: 'blta9b90878af9436b4',
  access_token: 'cs79086e32ff712b934208ced7',
};
const SOURCE_URL = 'https://oca.uy/beneficios.html';

/**
 * `marketing_benefits_category` (mismo Contentstack) tiene ~19 categorías.
 * Solo 2 mapean 1:1 y sin ambigüedad a las nuestras — las mapeamos acá para
 * poder auto-descubrir cadenas nuevas con confianza. Deliberadamente NO
 * mapeamos "salud"/"bienestar" a Farmacias: mezclan farmacias reales
 * (Homeopatía Alemana) con ópticas y cuidado personal (Óptica Florida,
 * Bela) — inventar esa categoría clasificaría mal comercios que no son
 * farmacias. Las farmacias de OCA solo matchean si ya existen en
 * MerchantChain (igual que antes).
 */
const CATEGORY_UID_TO_MVP: Record<string, MvpCategoryName> = {
  blt20e24482691dc97e: 'Supermercados', // "supermercado"
  blt1d4c56f9d17a15a1: 'Restaurantes', // "gastronomia"
};

interface ContentstackBenefit {
  brand?: string;
  title?: string;
  date_ini?: string;
  date_end?: string;
  days?: string[];
  description_terms?: string;
  category?: Array<{ uid: string }>;
}

interface ContentstackResponse {
  entries: Array<{ benefits?: ContentstackBenefit[] }>;
}

// `new Date('2026-08-01')` parsea como medianoche UTC; combinado con
// setHours (hora local) en startOfDay/endOfDay, el día termina corrido en
// cualquier timezone != UTC. Contentstack manda fechas "YYYY-MM-DD" sin
// hora, así que las construimos directo en hora local para no pisarnos.
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

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

function stripHtml(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}

function inferPaymentType(text: string): PaymentType {
  const hasCredito = /cr[ée]dito/i.test(text);
  const hasDebito = /d[ée]bito/i.test(text);
  if (hasCredito && !hasDebito) return PaymentType.CREDITO;
  if (hasDebito && !hasCredito) return PaymentType.DEBITO;
  return PaymentType.AMBOS;
}

function resolveCategoryName(
  benefit: ContentstackBenefit,
): MvpCategoryName | undefined {
  for (const cat of benefit.category ?? []) {
    const mapped = CATEGORY_UID_TO_MVP[cat.uid];
    if (mapped) return mapped;
  }
  return undefined;
}

function parseCapAmount(text: string): number | undefined {
  const match = text.match(/tope[^.$]*\$\s?([\d][\d.,]*)/i);
  if (!match) return undefined;
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

@Injectable()
export class OcaBenefitsScraper implements BankScraper {
  readonly bankName = 'OCA';
  private readonly logger = new Logger(OcaBenefitsScraper.name);

  async scrape(): Promise<ScrapedPromotion[]> {
    const benefits = await this.fetchBenefits();
    return this.normalize(benefits);
  }

  private async fetchBenefits(): Promise<ContentstackBenefit[]> {
    const response = await fetch(CONTENTSTACK_URL, {
      headers: CONTENTSTACK_HEADERS,
    });
    if (!response.ok) {
      throw new Error(
        `Contentstack (OCA beneficios) respondió ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as ContentstackResponse;
    return body.entries[0]?.benefits ?? [];
  }

  normalize(benefits: ContentstackBenefit[]): ScrapedPromotion[] {
    const promotions: ScrapedPromotion[] = [];

    for (const benefit of benefits) {
      const merchantChainName = benefit.brand?.trim() || benefit.title?.trim();
      if (!merchantChainName) continue;

      // El modelo de datos del MVP no distingue vigencia por día de la
      // semana. Si el beneficio no aplica los 7 días, ingerirlo con un
      // rango de fechas plano sobreestimaría cuándo está disponible — lo
      // salteamos en vez de inventar cobertura que no existe.
      if (!benefit.days || benefit.days.length < 7) {
        this.logger.debug(
          `Salteo "${merchantChainName}": no aplica todos los días (día-de-semana no soportado en el MVP)`,
        );
        continue;
      }

      if (!benefit.date_ini || !benefit.date_end) continue;

      const text = stripHtml(benefit.description_terms ?? '');
      const percentMatch = text.match(/(\d{1,2})\s*%/);
      if (!percentMatch) {
        this.logger.debug(
          `Sin porcentaje detectable, salteo: ${merchantChainName}`,
        );
        continue;
      }

      promotions.push({
        merchantChainName,
        categoryName: resolveCategoryName(benefit),
        discountPercentage: Number(percentMatch[1]),
        paymentType: inferPaymentType(text),
        capAmount: parseCapAmount(text),
        validFrom: startOfDay(parseDateOnly(benefit.date_ini)),
        validUntil: endOfDay(parseDateOnly(benefit.date_end)),
        sourceUrl: SOURCE_URL,
      });
    }

    return promotions;
  }
}
