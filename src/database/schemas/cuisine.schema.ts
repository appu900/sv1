import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Cuisine {
  @Prop({ required: true, unique: true, trim: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  imageUrl?: string;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: true })
  isActive: boolean;
}

export type CuisineDocument = Cuisine & Document;
export const CuisineSchema = SchemaFactory.createForClass(Cuisine);

CuisineSchema.index({ isActive: 1, order: 1, title: 1 });
