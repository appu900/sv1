import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Hackscategory {
  @Prop({ required: true, })
  name: string;

  @Prop({ required: true })
  imageUrl: string;
}
export type HackCategoryDocument = Hackscategory & Document
export const HacksCategorySchema = SchemaFactory.createForClass(Hackscategory)