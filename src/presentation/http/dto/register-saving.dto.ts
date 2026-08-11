import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class RegisterSavingDto {
  @IsString()
  @MinLength(1)
  whatsapp!: string;

  @IsString()
  @MinLength(1)
  branchId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;
}
