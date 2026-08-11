import { Module } from '@nestjs/common';
import { SavingsController } from '../../presentation/http/controllers/savings.controller';
import { SearchModule } from '../search/search.module';
import { RegisterSavingUseCase } from './register-saving.use-case';

@Module({
  imports: [SearchModule],
  controllers: [SavingsController],
  providers: [RegisterSavingUseCase],
  exports: [RegisterSavingUseCase],
})
export class SavingsModule {}
