import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncPromotionsUseCase } from '../../application/scraping/sync-promotions.use-case';

@Injectable()
export class PromotionsSyncCron {
  private readonly logger = new Logger(PromotionsSyncCron.name);

  constructor(private readonly syncPromotions: SyncPromotionsUseCase) {}

  // 03:00 Montevideo — de madrugada, antes de que arranque a moverse gente.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'America/Montevideo' })
  async handleCron() {
    this.logger.log('Arrancando sync diario de promociones...');
    const results = await this.syncPromotions.execute();
    this.logger.log(`Sync terminado: ${JSON.stringify(results)}`);
  }
}
