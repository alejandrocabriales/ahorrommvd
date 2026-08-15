/**
 * Runner manual para desarrollo: dispara el mismo sync que corre el cron
 * diario (PromotionsSyncCron), sin esperar a las 3am.
 *
 * Uso: npm run scrape:run | npm run scrape:run:prod
 *
 * `--prod` pisa DATABASE_URL con DATABASE_PUBLIC_URL antes de arrancar Nest,
 * igual que sync-branches.script.ts y data-report.script.ts (mismo motivo:
 * tener las dos conexiones en el .env sin copiar/pegar).
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SyncPromotionsUseCase } from '../../application/scraping/sync-promotions.use-case';

const targetsProd = process.argv.includes('--prod');

if (targetsProd) {
  const prodUrl = process.env.DATABASE_PUBLIC_URL;
  if (!prodUrl) {
    console.error(
      'Falta DATABASE_PUBLIC_URL en el .env — pegá ahí el connection string público del addon de Postgres en Railway (no el interno, ese es DATABASE_URL y solo funciona entre servicios de Railway).',
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = prodUrl;
}

async function main() {
  console.log(`Corriendo contra ${targetsProd ? 'PRODUCCIÓN' : 'LOCAL'}...`);
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
