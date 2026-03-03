import {
  IsNumber,
  IsArray,
  IsString,
  IsOptional,
  IsObject,
  Min,
  IsInt,
} from 'class-validator';

export class CreateTrackSurveyDto {
  @IsInt()
  @Min(0)
  cookingFrequency: number;

  @IsInt()
  @Min(0)
  scraps: number;

  @IsInt()
  @Min(0)
  uneatenLeftovers: number;

  @IsObject()
  produceWaste: Record<string, number>;

  @IsArray()
  @IsString({ each: true })
  preferredIngredients: string[];

  @IsInt()
  @Min(1)
  @IsOptional()
  noOfCooks?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  surveyDay?: number; 

  @IsString()
  @IsOptional()
  country?: string; 
}
