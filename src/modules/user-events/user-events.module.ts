import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserEvent,
  UserEventSchema,
} from '../../database/schemas/user-event.schema';
import {
  RecipeView,
  RecipeViewSchema,
} from '../../database/schemas/recipe-view.schema';
import {
  FeatureUsageEvent,
  FeatureUsageEventSchema,
} from '../../database/schemas/feature-usage-event.schema';
import { Recipe, RecipeSchema } from '../../database/schemas/recipe.schema';
import {
  userRecipe,
  UserRecipeSchema,
} from '../../database/schemas/user.schema';
import { UserEventService } from './user-event.service';
import { RecipeViewService } from './recipe-view.service';
import { FeatureUsageService } from './feature-usage.service';
import { UserEventsController } from './user-events.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEvent.name, schema: UserEventSchema },
      { name: RecipeView.name, schema: RecipeViewSchema },
      { name: FeatureUsageEvent.name, schema: FeatureUsageEventSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: userRecipe.name, schema: UserRecipeSchema },
    ]),
  ],
  controllers: [UserEventsController],
  providers: [UserEventService, RecipeViewService, FeatureUsageService],
  exports: [UserEventService, RecipeViewService, FeatureUsageService],
})
export class UserEventsModule {}
