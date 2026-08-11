import { Injectable, Logger } from '@nestjs/common';
import { BankScraper } from '../../../domain/scraping/bank-scraper.port';
import { ScrapedPromotion } from '../../../domain/scraping/scraped-promotion';

/**
 * PENDIENTE — bloqueado en investigación (Semana 2).
 *
 * https://www.itau.com.uy/inst/beneficios.html no trae los descuentos en el
 * HTML inicial (a diferencia de Santander) ni expone un endpoint público
 * como OCA (Contentstack). Es una SPA React (bundle
 * /inst/includes/beneficios/js.*.js, ~1MB, incluye react-google-maps) que
 * arma la grilla client-side; no encontré la URL de datos analizando el
 * bundle de forma estática (sin baseURL/fetch hardcodeada visible).
 *
 * Además Itaú publica campañas sueltas por categoría en páginas separadas
 * (moda.html, itauweek.html, beneficiosexclusivos.html) sin un feed único —
 * puede que ni exista un catálogo estructurado equivalente al de los otros
 * dos bancos.
 *
 * Próximo paso real: abrir beneficios.html con devtools (pestaña Network)
 * y mirar qué XHR/fetch dispara al cargar — esto no se puede hacer con
 * curl/WebFetch, hace falta un browser de verdad. Si no aparece una API,
 * la alternativa es Playwright renderizando la página y leyendo el DOM ya
 * hidratado.
 */
@Injectable()
export class ItauBenefitsScraper implements BankScraper {
  readonly bankName = 'Itaú';
  private readonly logger = new Logger(ItauBenefitsScraper.name);

  scrape(): Promise<ScrapedPromotion[]> {
    this.logger.warn(
      'Scraper de Itaú no implementado todavía — ver comentario en itau-benefits.scraper.ts. Devuelvo [] para no romper el sync de los otros bancos.',
    );
    return Promise.resolve([]);
  }
}
