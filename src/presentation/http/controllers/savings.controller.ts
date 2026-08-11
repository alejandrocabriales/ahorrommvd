import { Body, Controller, Post } from '@nestjs/common';
import { RegisterSavingUseCase } from '../../../application/savings/register-saving.use-case';
import { RegisterSavingDto } from '../dto/register-saving.dto';

@Controller('savings')
export class SavingsController {
  constructor(private readonly registerSaving: RegisterSavingUseCase) {}

  @Post()
  register(@Body() dto: RegisterSavingDto) {
    return this.registerSaving.execute(dto.whatsapp, dto.branchId, dto.amount);
  }
}
