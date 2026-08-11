import { Controller, Get, Query } from '@nestjs/common';
import { MerchantSearchService } from '../../../application/search/merchant-search.service';
import { BranchesSearchQueryDto } from '../dto/branches-search-query.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly merchantSearch: MerchantSearchService) {}

  @Get('search')
  search(@Query() query: BranchesSearchQueryDto) {
    return this.merchantSearch.searchBranchesOnly(query.q, query.limit);
  }
}
