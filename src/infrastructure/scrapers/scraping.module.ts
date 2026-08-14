import { Module } from '@nestjs/common';
import { SyncPromotionsUseCase } from '../../application/scraping/sync-promotions.use-case';
import { BANK_SCRAPERS } from '../../domain/scraping/bank-scraper.port';
import { ItauBenefitsScraper } from './itau/itau-benefits.scraper';
import { OcaBenefitsScraper } from './oca/oca-benefits.scraper';
import { PromotionsSyncCron } from './promotions-sync.cron';
import { SantanderBenefitsScraper } from './santander/santander-benefits.scraper';

@Module({
  providers: [
    SantanderBenefitsScraper,
    OcaBenefitsScraper,
    ItauBenefitsScraper,
    {
      provide: BANK_SCRAPERS,
      useFactory: (
        santander: SantanderBenefitsScraper,
        oca: OcaBenefitsScraper,
        itau: ItauBenefitsScraper,
      ) => [santander, oca, itau],
      inject: [
        SantanderBenefitsScraper,
        OcaBenefitsScraper,
        ItauBenefitsScraper,
      ],
    },
    SyncPromotionsUseCase,
    PromotionsSyncCron,
  ],
  // BANK_SCRAPERS se exporta para el reporte de datos (ReportingModule), que
  // corre los mismos scrapers en seco — si tuviera su propia lista, el
  // reporte podría medir algo distinto de lo que el cron ingiere.
  exports: [SyncPromotionsUseCase, BANK_SCRAPERS],
})
export class ScrapingModule {}
