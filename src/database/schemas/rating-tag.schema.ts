import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RatingTagDocument = RatingTag & Document;

@Schema({ timestamps: true })
export class RatingTag {
  @Prop({ required: true, unique: true, index: true })
  name: string;

  @Prop({ required: true })
  order: number; // Higher order = higher rating priority

  @Prop({ type: String })
  description?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const RatingTagSchema = SchemaFactory.createForClass(RatingTag);
