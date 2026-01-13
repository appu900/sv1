import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class UserBadge {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Badge', required: true, index: true })
  badgeId: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  earnedAt: Date;

  // Store the actual value achieved when badge was earned
  @Prop({ type: Number })
  achievedValue?: number;

  // Additional context: challengeId for challenge winners, period for time-based badges
  @Prop({ type: Object })
  metadata?: {
    challengeId?: string;
    challengeName?: string;
    period?: string; // e.g., "2024-01", "2024-Q1"
    rank?: number; // For leaderboard position
    totalParticipants?: number;
  };

  @Prop({ default: false })
  isNotified: boolean; // Track if user was notified about this badge

  @Prop({ default: false })
  isViewed: boolean; // Track if user has seen this badge
}

export type UserBadgeDocument = UserBadge & Document;
export const UserBadgeSchema = SchemaFactory.createForClass(UserBadge);

// Compound index to prevent duplicate badge awards
UserBadgeSchema.index({ userId: 1, badgeId: 1 }, { unique: true });
UserBadgeSchema.index({ userId: 1, earnedAt: -1 });
UserBadgeSchema.index({ badgeId: 1 });
