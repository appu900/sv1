import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FrameworkCategoryController } from './framework-category.controller';
import { FrameworkCategoryService } from './framework-category.service';
import {
  FrameworkCategory,
  FrameworkCategorySchema,
} from '../../database/schemas/framework-category.schema';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FrameworkCategory.name, schema: FrameworkCategorySchema },
    ]),
    RedisModule,
  ],
  controllers: [FrameworkCategoryController],
  providers: [FrameworkCategoryService],
  exports: [FrameworkCategoryService],
})
export class FrameworkCategoryModule {}
