import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class FrameworkCategory {
  @Prop({ required: true, unique: true })
  title: string;

  @Prop({ required: false })
  description?: string;

  @Prop({ default: 0 })
  order?: number;

  @Prop({ default: true })
  isActive: boolean;
}

export type FrameworkCategoryDocument = FrameworkCategory & Document;
export const FrameworkCategorySchema =
  SchemaFactory.createForClass(FrameworkCategory);

FrameworkCategorySchema.index({ isActive: 1 });
FrameworkCategorySchema.index({ order: 1 });
