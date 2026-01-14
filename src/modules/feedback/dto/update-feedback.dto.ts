import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class FeedbackDataDto {
  @IsOptional()
  @IsBoolean()
  did_you_like_it?: boolean;

  @IsOptional()
  @IsNumber()
  food_saved?: number;

  @IsOptional()
  @IsString()
  meal_id?: string;

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  review?: string;
}

export class UpdateFeedbackDto {
  @IsOptional()
  @IsBoolean()
  prompted?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FeedbackDataDto)
  data?: FeedbackDataDto;
}
