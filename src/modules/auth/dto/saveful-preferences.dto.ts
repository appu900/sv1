import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  SAVEFUL_CADENCES,
  SAVEFUL_EXPERIENCES,
  SAVEFUL_FOCUS_AREAS,
  SAVEFUL_WEEKDAYS,
  SavefulCadence,
  SavefulExperience,
  SavefulFocusArea,
  SavefulWeekday,
} from 'src/database/schemas/user-saveful-preferences.schema';

export class SavefulPreferencesDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(SAVEFUL_FOCUS_AREAS, { each: true })
  focusAreas?: SavefulFocusArea[];

  @IsOptional()
  @IsString()
  @IsIn(SAVEFUL_CADENCES)
  cadence?: SavefulCadence;

  @IsOptional()
  @IsString()
  @IsIn(SAVEFUL_EXPERIENCES)
  selectedExperience?: SavefulExperience;

  @IsOptional()
  @IsString()
  @IsIn(SAVEFUL_WEEKDAYS)
  weeklySurveyDay?: SavefulWeekday;
}
