import { ScrapedPromotion } from './scraped-promotion';

export interface BankScraper {
  readonly bankName: string;
  scrape(): Promise<ScrapedPromotion[]>;
}

export const BANK_SCRAPERS = Symbol('BANK_SCRAPERS');
