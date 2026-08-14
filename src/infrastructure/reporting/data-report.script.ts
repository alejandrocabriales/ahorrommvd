/**
 * Runner manual del reporte de datos: qué tenemos cargado, cuánto de eso es
 * recomendable de verdad, y cuánto se pierde en la ingesta.
 *
 * Uso:
 *   npm run data:report              -> base local, sin correr scrapers
 *   npm run data:report -- --scrape  -> además corre los scrapers en seco
 *   npm run data:report:prod         -> misma foto contra la base de Railway
 *
 * `--prod` pisa DATABASE_URL con DATABASE_PUBLIC_URL antes de arrancar Nest,
 * igual que sync-branches.script.ts (mismo motivo: tener las dos conexiones
 * en el .env sin copiar/pegar). Solo lee: ni los scrapers en seco escriben
 * nada.
 *
 * Compila antes de correr (`npm run build && node dist/...`) en vez de usar
 * tsx como los scripts de IA: esbuild no emite `design:paramtypes`, así que
 * cualquier script que levante el contexto de Nest se cae con dependencias
 * "undefined at runtime".
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { BuildDataReportUseCase } from '../../application/reporting/build-data-report.use-case';
import { formatDataReport } from '../../application/reporting/format-data-report';

const targetsProd = process.argv.includes('--prod');
const includeIngestion = process.argv.includes('--scrape');

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
  console.log(
    `Leyendo ${targetsProd ? 'PRODUCCIÓN' : 'LOCAL'}${includeIngestion ? ' + corriendo scrapers en seco' : ''}...\n`,
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const report = await app.get(BuildDataReportUseCase).execute({
    includeIngestion,
  });
  console.log(formatDataReport(report));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
