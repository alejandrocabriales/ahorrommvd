import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SavingsModule } from './application/savings/savings.module';
import { SearchModule } from './application/search/search.module';
import { WhatsAppModule } from './application/whatsapp/whatsapp.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { ScrapingModule } from './infrastructure/scrapers/scraping.module';
import { HealthController } from './presentation/http/controllers/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ScrapingModule,
    SearchModule,
    SavingsModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
