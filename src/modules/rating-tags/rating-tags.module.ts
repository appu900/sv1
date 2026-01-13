import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RatingTagsService } from './rating-tags.service';
import { RatingTagsController } from './rating-tags.controller';
import { RatingTag, RatingTagSchema } from 'src/database/schemas/rating-tag.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RatingTag.name, schema: RatingTagSchema },
    ]),
  ],
  controllers: [RatingTagsController],
  providers: [RatingTagsService],
  exports: [RatingTagsService],
})
export class RatingTagsModule {}
