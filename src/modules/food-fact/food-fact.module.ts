import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FoodFactController } from './food-fact.controller';
import { FoodFactService } from './food-fact.service';
import { FoodFact, FoodFactSchema } from 'src/database/schemas/food-fact.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FoodFact.name, schema: FoodFactSchema },
    ]),
    ImageUploadModule,
  ],
  controllers: [FoodFactController],
  providers: [FoodFactService],
  exports: [FoodFactService],
})
export class FoodFactModule {}
