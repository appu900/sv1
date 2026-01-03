import { Module } from '@nestjs/common';
import { StickerController } from './sticker.controller';
import { StickerService } from './sticker.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Stickers, StickerSchema } from 'src/database/schemas/stcikers.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';

@Module({
  imports:[
    MongooseModule.forFeature([
      {name:Stickers.name,schema:StickerSchema}
    ]),
    ImageUploadModule
  ],
  controllers: [StickerController],
  providers: [StickerService]
})
export class StickerModule {}
