import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';


@Schema({ timestamps: true })
export class ScaledPortionsCache {
  @Prop({ required: true, unique: true, index: true })
  cacheKey: string;

  @Prop({ required: false, index: true })
  recipeId?: string;

  @Prop({ required: true })
  originalServings: number;

  @Prop({ required: true })
  desiredServings: number;

  @Prop({ required: true, type: Object })
  result: Record<string, unknown>;
}

export type ScaledPortionsCacheDocument = ScaledPortionsCache & Document;
export const ScaledPortionsCacheSchema = SchemaFactory.createForClass(ScaledPortionsCache);
