import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Stickers {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ required: true })
  description: string;
}


export type StickerDocument = Stickers & Document
export const StickerSchema = SchemaFactory.createForClass(Stickers)