import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MealSlot } from '../../../database/schemas/nutrition/daily-intake.schema';

/**
 * Body fields sent alongside the image file in a multipart form.
 * Because multipart/form-data sends everything as strings,
 * we use @Transform to coerce numeric and boolean fields.
 */
export class PhotoQuickAddDto {
  /** Optional user hint — e.g. "this is dal chawal with papad" */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  /** Optional serving label — e.g. "1 large plate" */
  @IsOptional()
  @IsString()
  @Length(0, 60)
  servingLabel?: string;

  /** Optional estimated serving weight in grams */
  @IsOptional()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  @IsNumber()
  @Min(1)
  @Max(5000)
  servingGrams?: number;

  /** Which meal slot to log under */
  @IsOptional()
  @IsEnum(MealSlot)
  mealSlot?: MealSlot;

  /** Date for the log entry (YYYY-MM-DD). Defaults to today in user's timezone */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  /** If true, automatically log the estimated nutrition to the daily intake */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  autoLog?: boolean;
}
