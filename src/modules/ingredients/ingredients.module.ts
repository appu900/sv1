import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { Mongoose } from 'mongoose';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IngredientsCategory,
  ingredinatsCategorySchema,
} from 'src/database/schemas/ingredinats.Category.schema';
import {
  Ingredient,
  IngredientSchema,
} from 'src/database/schemas/ingredient.schema';
import {
  DietCategory,
  DietCategorySchema,
} from 'src/database/schemas/diet.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';
import { SqsModule } from 'src/sqs/sqs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IngredientsCategory.name, schema: ingredinatsCategorySchema },
      { name: Ingredient.name, schema: IngredientSchema },
      { name: DietCategory.name, schema: DietCategorySchema },
    ]),
    ImageUploadModule,
    SqsModule
  ],
  controllers: [IngredientsController],
  providers: [IngredientsService],
})
export class IngredientsModule {}
