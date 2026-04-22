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
import { Recipe, RecipeSchema } from '../../database/schemas/recipe.schema';
import {
  userRecipe,
  UserRecipeSchema,
} from '../../database/schemas/user.schema';
import { UserEventService } from './user-event.service';
import { RecipeViewService } from './recipe-view.service';
import { UserEventsController } from './user-events.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEvent.name, schema: UserEventSchema },
      { name: RecipeView.name, schema: RecipeViewSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: userRecipe.name, schema: UserRecipeSchema },
    ]),
  ],
  controllers: [UserEventsController],
  providers: [UserEventService, RecipeViewService],
  exports: [UserEventService, RecipeViewService],
})
export class UserEventsModule {}
