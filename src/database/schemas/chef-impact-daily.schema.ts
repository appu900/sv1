import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: true } })
export class ChefImpactDaily {
  @Prop({ type: Types.ObjectId, ref: 'ChefProfile', required: true, index: true })
  chefId: Types.ObjectId;

  /** UTC midnight for the calendar day */
  @Prop({ type: Date, required: true, index: true })
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

export type ChefImpactDailyDocument = ChefImpactDaily & Document;
export const ChefImpactDailySchema = SchemaFactory.createForClass(ChefImpactDaily);

ChefImpactDailySchema.index({ chefId: 1, day: 1 }, { unique: true });
ChefImpactDailySchema.index({ day: 1, mealsCooked: -1 });
ChefImpactDailySchema.index({ day: 1, foodSavedInGrams: -1 });
ChefImpactDailySchema.index({ day: 1, co2SavedInGrams: -1 });
