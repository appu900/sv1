import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ 
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret: any) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
})
export class Stickers {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop()
  description?: string;
}


export type StickerDocument = Stickers & Document
export const StickerSchema = SchemaFactory.createForClass(Stickers)