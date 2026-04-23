import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class LeaderboardProfile {
  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 30 })
  displayName: string;

  @Prop({ default: true })
  isActive: boolean;
}

export type LeaderboardProfileDocument = LeaderboardProfile & Document;
export const LeaderboardProfileSchema = SchemaFactory.createForClass(LeaderboardProfile);


LeaderboardProfileSchema.index(
  { isActive: 1, userId: 1 },
  { partialFilterExpression: { isActive: true } },
);
