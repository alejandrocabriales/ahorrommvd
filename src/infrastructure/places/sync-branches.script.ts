/**
 * Runner manual: backfill de sucursales reales (Google Places) para las
 * cadenas que todavía no tienen ninguna. No corre solo — se dispara a mano
 * hasta que se decida meterlo en un cron.
 *
 * Uso: npm run branches:sync:local | npm run branches:sync:prod
 *
 * `--prod` pisa DATABASE_URL con DATABASE_PUBLIC_URL ANTES de arrancar Nest
 * (que es quien lo lee vía PrismaService) — mismo nombre que Railway le da
 * en su dashboard al connection string público del addon de Postgres, así
 * el `.env` puede tener las dos conexiones a la vez (local de docker +
 * pública de Railway) sin que haya que copiar/pegar ni arriesgarse a dejar
 * producción cargada por error para el resto del desarrollo local.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SyncBranchesUseCase } from '../../application/branches/sync-branches.use-case';

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

console.log(`Corriendo contra ${targetsProd ? 'PRODUCCIÓN' : 'LOCAL'}...`);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const useCase = app.get(SyncBranchesUseCase);
  const results = await useCase.execute();
  console.log(JSON.stringify(results, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
