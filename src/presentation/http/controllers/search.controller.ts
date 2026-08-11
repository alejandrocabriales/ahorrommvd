import { Controller, Get, Query } from '@nestjs/common';
import { SearchUseCase } from '../../../application/search/search.use-case';
import { SearchQueryDto } from '../dto/search-query.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchUseCase: SearchUseCase) {}

  @Get()
  search(@Query() query: SearchQueryDto) {
    return this.searchUseCase.execute(query);
  }
}
