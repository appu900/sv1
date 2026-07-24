import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: true } })
export class ChefLeaderboardSnapshot {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({ type: Date, default: Date.now })
  computedAt: Date;
}

export type ChefLeaderboardSnapshotDocument = ChefLeaderboardSnapshot & Document;
export const ChefLeaderboardSnapshotSchema =
  SchemaFactory.createForClass(ChefLeaderboardSnapshot);
