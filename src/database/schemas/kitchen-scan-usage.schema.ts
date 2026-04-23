import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class KitchenScanUsage {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  count: number;

  @Prop({ type: Date })
  lastUsedAt?: Date;
}

export type KitchenScanUsageDocument = KitchenScanUsage & Document;
export const KitchenScanUsageSchema = SchemaFactory.createForClass(KitchenScanUsage);
