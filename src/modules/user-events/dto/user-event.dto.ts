import { IsEnum, IsMongoId, IsObject, IsOptional } from 'class-validator';
import {
  RecipeViewSource,
} from '../../../database/schemas/recipe-view.schema';
import { UserEventType } from '../../../database/schemas/user-event.schema';

export class RecordUserEventDto {
  @IsEnum(UserEventType)
  eventType: UserEventType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class RecordRecipeViewDto {
  @IsMongoId()
  recipeId: string;

  @IsOptional()
  @IsEnum(RecipeViewSource)
  source?: RecipeViewSource;
}
