import { Module } from '@nestjs/common';
import { AiModule } from '../../infrastructure/ai/ai.module';
import { WhatsAppSenderService } from '../../infrastructure/whatsapp/whatsapp-sender.service';
import { WhatsAppController } from '../../presentation/http/controllers/whatsapp.controller';
import { SavingsModule } from '../savings/savings.module';
import { SearchModule } from '../search/search.module';
import { HandleWhatsAppMessageUseCase } from './handle-whatsapp-message.use-case';

@Module({
  imports: [AiModule, SearchModule, SavingsModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppSenderService, HandleWhatsAppMessageUseCase],
})
export class WhatsAppModule {}
