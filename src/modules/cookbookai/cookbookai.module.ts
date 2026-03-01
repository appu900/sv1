import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CookbookaiController } from './cookbookai.controller';
import { CookbookaiService } from './cookbookai.service';
import { userRecipe, UserRecipeSchema, UserRecipeDocument } from 'src/database/schemas/user.schema';
import { UserModule } from '../user/user.module';
import { RecipeModule } from '../recipe/recipe.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: userRecipe.name, schema: UserRecipeSchema },
    ]),
    UserModule,
    RecipeModule,
  ],
  controllers: [CookbookaiController],
  providers: [CookbookaiService]
})
export class CookbookaiModule {}
