import { Module } from '@nestjs/common';
import { HackController } from './hack.controller';
import { HackService } from './hack.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Hackscategory,
  HacksCategorySchema,
} from 'src/database/schemas/hacks.category.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';
import { Hacks, HackSchema } from 'src/database/schemas/hacks.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hackscategory.name, schema: HacksCategorySchema },
      {name:Hacks.name,schema:HackSchema}
    ]),
    ImageUploadModule,
  ],
  controllers: [HackController],
  providers: [HackService],
})
export class HackModule {}
