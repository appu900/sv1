import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { Mongoose } from 'mongoose';
import { MongooseModule } from '@nestjs/mongoose';
import { IngredientsCategory, ingredinatsCategorySchema } from 'src/database/schemas/ingredinats.Category.schema';
import { ImageUploadService } from '../image-upload/image-upload.service';

@Module({
  imports:[
    MongooseModule.forFeature([
      {name:IngredientsCategory.name,schema:ingredinatsCategorySchema}
    ]),
  ],
  controllers: [IngredientsController],
  providers: [IngredientsService]
})
export class IngredientsModule {}
