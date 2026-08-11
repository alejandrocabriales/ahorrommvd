import { Controller, Get, Query } from '@nestjs/common';
import { GetPromotionComparisonUseCase } from '../../../application/search/get-promotion-comparison.use-case';
import { PromotionsUpcomingQueryDto } from '../dto/promotions-upcoming-query.dto';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly getComparison: GetPromotionComparisonUseCase) {}

  @Get('upcoming')
  upcoming(@Query() query: PromotionsUpcomingQueryDto) {
    return this.getComparison.execute(query.merchantChainId, query.branchId);
  }
}
