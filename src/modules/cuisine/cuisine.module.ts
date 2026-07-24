import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CuisineController } from './cuisine.controller';
import { CuisineService } from './cuisine.service';
import { Cuisine, CuisineSchema } from '../../database/schemas/cuisine.schema';
import { RedisModule } from '../../redis/redis.module';
import { ImageUploadModule } from '../image-upload/image-upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cuisine.name, schema: CuisineSchema }]),
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 20,
      },
    }),
    RedisModule,
    ImageUploadModule,
  ],
  controllers: [CuisineController],
  providers: [CuisineService],
  exports: [CuisineService],
})
export class CuisineModule {}
