import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
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
