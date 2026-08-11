import { IsOptional, IsString, MinLength } from 'class-validator';

export class PromotionsUpcomingQueryDto {
  @IsString()
  @MinLength(1)
  merchantChainId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
