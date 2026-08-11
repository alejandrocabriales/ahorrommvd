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
  exports: [SyncPromotionsUseCase],
})
export class ScrapingModule {}
