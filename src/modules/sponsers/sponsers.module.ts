import { Module } from '@nestjs/common';
import { SponsersController } from './sponsers.controller';
import { SponsersService } from './sponsers.service';
import { MongooseModule, Schema } from '@nestjs/mongoose';
import { Sponsers, SponsersSchema } from 'src/database/schemas/sponsers.schema';
import { ImageUploadModule } from '../image-upload/image-upload.module';

@Module({
  imports:[
    MongooseModule.forFeature([
      {name:Sponsers.name,schema:SponsersSchema}
    ]),
    ImageUploadModule
  ],
  controllers: [SponsersController],
  providers: [SponsersService]
})
export class SponsersModule {}
