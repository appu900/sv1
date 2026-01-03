import { Module } from '@nestjs/common';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';
import { MongooseModule } from '@nestjs/mongoose';
import { DietCategory, DietCategorySchema } from 'src/database/schemas/diet.schema';

@Module({
  imports:[MongooseModule.forFeature([
    {name:DietCategory.name,schema:DietCategorySchema}
  ])],
  controllers: [DietController],
  providers: [DietService]
})
export class DietModule {}
