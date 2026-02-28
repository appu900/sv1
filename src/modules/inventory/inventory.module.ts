import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryAiService } from './inventory-ai.service';
import { InventoryExpiryCronService } from './inventory-expiry-cron.service';
import {
  UserInventoryItem,
  UserInventoryItemSchema,
} from '../../database/schemas/user-inventory.schema';
import {
  Ingredient,
  IngredientSchema,
} from '../../database/schemas/ingredient.schema';
import {
  Recipe,
  RecipeSchema,
} from '../../database/schemas/recipe.schema';
import {
  ShoppingList,
  ShoppingListSchema,
} from '../../database/schemas/shopping-list.schema';
import {
  User,
  UserSchema,
} from '../../database/schemas/user.auth.schema';
import { RedisModule } from '../../redis/redis.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: UserInventoryItem.name, schema: UserInventoryItemSchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: ShoppingList.name, schema: ShoppingListSchema },
      { name: User.name, schema: UserSchema },
    ]),
    RedisModule,
    NotificationModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryAiService, InventoryExpiryCronService],
  exports: [InventoryService, InventoryAiService],
})
export class InventoryModule {}
