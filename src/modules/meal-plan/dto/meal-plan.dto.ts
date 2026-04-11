import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateMealPlanDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  days?: number;

  @IsOptional()
  @IsString()
  preference?: string;
}

export class GenerateRecipeFromPlanDto {
  @IsString()
  planId: string;

  @IsInt()
  @Min(1)
  dayNumber: number;

  @IsString()
  slot: string;
}
