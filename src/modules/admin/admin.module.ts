import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';
import { Hacks, HackSchema } from 'src/database/schemas/hacks.schema';
import { Sponsers, SponsersSchema } from 'src/database/schemas/sponsers.schema';
import { FoodFact, FoodFactSchema } from 'src/database/schemas/food-fact.schema';
import { Stickers, StickerSchema } from 'src/database/schemas/stcikers.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: Hacks.name, schema: HackSchema },
      { name: Sponsers.name, schema: SponsersSchema },
      { name: FoodFact.name, schema: FoodFactSchema },
      { name: Stickers.name, schema: StickerSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
