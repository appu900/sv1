import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: true } })
export class ChefCommunityDaily {
  /** UTC midnight for the calendar day */
  @Prop({ type: Date, required: true, unique: true })
  day: Date;

  @Prop({ type: Number, default: 0, min: 0 })
  mealsCooked: number;

  @Prop({ type: Number, default: 0, min: 0 })
  moneySaved: number;

  @Prop({ type: Map, of: Number, default: {} })
  moneyByCurrency: Map<string, number>;

  @Prop({ type: Number, default: 0, min: 0 })
  foodSavedInGrams: number;

  @Prop({ type: Number, default: 0, min: 0 })
  co2SavedInGrams: number;
}

export type ChefCommunityDailyDocument = ChefCommunityDaily & Document;
export const ChefCommunityDailySchema =
  SchemaFactory.createForClass(ChefCommunityDaily);
