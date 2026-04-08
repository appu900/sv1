import { IsOptional, IsString, Length, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AiEstimateDto {
  @IsString()
  @Length(2, 200)
  foodDescription: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  servingLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  servingGrams?: number;
}
