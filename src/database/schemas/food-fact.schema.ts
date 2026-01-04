import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class FoodFact {
  @Prop({ required: true })
  title: string;

  @Prop({ type: Types.ObjectId, ref: 'Sponsers', required: false })
  sponsor?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: false })
  relatedIngredient?: Types.ObjectId;

  @Prop({ required: false })
  factOrInsight?: string;
}

export type FoodFactDocument = FoodFact & Document;
export const FoodFactSchema = SchemaFactory.createForClass(FoodFact);
