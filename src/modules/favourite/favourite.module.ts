import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavouriteService } from './favourite.service';
import { FavouriteController } from './favourite.controller';
import { Favourite, FavouriteSchema } from 'src/database/schemas/favourite.schema';
import { Recipe, RecipeSchema } from 'src/database/schemas/recipe.schema';
import { Hacks, HackSchema } from 'src/database/schemas/hacks.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Favourite.name, schema: FavouriteSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: Hacks.name, schema: HackSchema },
    ]),
  ],
  controllers: [FavouriteController],
  providers: [FavouriteService],
  exports: [FavouriteService],
})
export class FavouriteModule {}
