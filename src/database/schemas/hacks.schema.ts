import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Hacks {
  @Prop({ required: true, index:true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({})
  imageUrl?:string;

  @Prop({})
  youtubeLink?:string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  categoryId: Types.ObjectId;
}



export type HackDocument = Hacks & Document
export const HackSchema = SchemaFactory.createForClass(Hacks)