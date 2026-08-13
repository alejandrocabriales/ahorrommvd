import { Module } from '@nestjs/common';
import { PlacesModule } from '../../infrastructure/places/places.module';
import { BranchesController } from '../../presentation/http/controllers/branches.controller';
import { PromotionsController } from '../../presentation/http/controllers/promotions.controller';
import { SearchController } from '../../presentation/http/controllers/search.controller';
import { BrowseByCategoryUseCase } from './browse-by-category.use-case';
import { GetPromotionComparisonUseCase } from './get-promotion-comparison.use-case';
import { MerchantSearchService } from './merchant-search.service';
import { ResolveMerchantUseCase } from './resolve-merchant.use-case';
import { SearchUseCase } from './search.use-case';

@Module({
  imports: [PlacesModule],
  controllers: [SearchController, BranchesController, PromotionsController],
  providers: [
    MerchantSearchService,
    ResolveMerchantUseCase,
    GetPromotionComparisonUseCase,
    SearchUseCase,
    BrowseByCategoryUseCase,
  ],
  exports: [
    SearchUseCase,
    BrowseByCategoryUseCase,
    GetPromotionComparisonUseCase,
  ],
})
export class SearchModule {}
