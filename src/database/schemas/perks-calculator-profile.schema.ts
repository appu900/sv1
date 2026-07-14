import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class PerksCalculatorProfile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: [Object], required: true })
  inputs: Array<Record<string, unknown>>;

  @Prop({ type: Object, required: true })
  result: Record<string, unknown>;

  @Prop({ type: Date, required: true })
  calculatedAt: Date;
}

export type PerksCalculatorProfileDocument = PerksCalculatorProfile & Document;
export const PerksCalculatorProfileSchema = SchemaFactory.createForClass(
  PerksCalculatorProfile,
);

PerksCalculatorProfileSchema.index({ userId: 1, calculatedAt: -1 });
