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
      // Itaú queda afuera de la lista activa a propósito: SyncPromotionsUseCase
      // borra-y-recrea las promociones del banco en cada corrida, y un scraper
      // que siempre devuelve [] (stub) terminaría borrando las promociones
      // ilustrativas de Itaú del seed sin reemplazarlas por nada real. Sumarlo
      // acá cuando itau-benefits.scraper.ts esté implementado de verdad.
      useFactory: (
        santander: SantanderBenefitsScraper,
        oca: OcaBenefitsScraper,
      ) => [santander, oca],
      inject: [SantanderBenefitsScraper, OcaBenefitsScraper],
    },
    SyncPromotionsUseCase,
    PromotionsSyncCron,
  ],
  exports: [SyncPromotionsUseCase],
})
export class ScrapingModule {}
