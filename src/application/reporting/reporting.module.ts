import { Module } from '@nestjs/common';
import { ScrapingModule } from '../../infrastructure/scrapers/scraping.module';
import { BuildDataReportUseCase } from './build-data-report.use-case';

/**
 * Diagnóstico, no camino de la app: nada del flujo de WhatsApp depende de
 * esto. Importa ScrapingModule solo para reusar los mismos scrapers que
 * corren en el cron — el reporte tiene que medir lo que de verdad se
 * ingiere, no una copia.
 */
@Module({
  imports: [ScrapingModule],
  providers: [BuildDataReportUseCase],
  exports: [BuildDataReportUseCase],
})
export class ReportingModule {}
