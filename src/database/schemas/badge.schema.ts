import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum BadgeCategory {
  MILESTONE = 'MILESTONE',
  CHALLENGE_WINNER = 'CHALLENGE_WINNER',
  SPECIAL = 'SPECIAL',
}

export enum MilestoneType {
  TOTAL_MEALS_COOKED = 'TOTAL_MEALS_COOKED',
  TOTAL_FOOD_SAVED = 'TOTAL_FOOD_SAVED',
  MONTHLY_MEALS_COOKED = 'MONTHLY_MEALS_COOKED',
  YEARLY_MEALS_COOKED = 'YEARLY_MEALS_COOKED',
  MONTHLY_FOOD_SAVED = 'MONTHLY_FOOD_SAVED',
  YEARLY_FOOD_SAVED = 'YEARLY_FOOD_SAVED',
  COOKING_STREAK = 'COOKING_STREAK',
  CHALLENGE_PARTICIPATION = 'CHALLENGE_PARTICIPATION',
}

@Schema({ timestamps: true })
export class Badge {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({
    type: String,
    enum: BadgeCategory,
    required: true,
    index: true,
  })
  category: BadgeCategory;

  @Prop({
    type: String,
    enum: MilestoneType,
    required: false,
  })
  milestoneType?: MilestoneType;

  @Prop({ type: Number })
  milestoneThreshold?: number;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: 0 })
  rarityScore: number; // Higher = more rare/valuable

  @Prop({ type: String })
  iconColor?: string; // Hex color for badge accent

  @Prop({ default: false })
  isDeleted: boolean;

  // For challenge winner badges
  @Prop({ type: String })
  challengeId?: string;
}

export type BadgeDocument = Badge & Document;
export const BadgeSchema = SchemaFactory.createForClass(Badge);

// Indexes for efficient queries
BadgeSchema.index({ category: 1, isActive: 1 });
BadgeSchema.index({ milestoneType: 1 });
BadgeSchema.index({ challengeId: 1 });
