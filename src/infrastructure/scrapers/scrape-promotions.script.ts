/**
 * Runner manual para desarrollo: dispara el mismo sync que corre el cron
 * diario (PromotionsSyncCron), sin esperar a las 3am. Uso: npm run scrape:run
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SyncPromotionsUseCase } from '../../application/scraping/sync-promotions.use-case';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const useCase = app.get(SyncPromotionsUseCase);
  const results = await useCase.execute();
  console.log(JSON.stringify(results, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
