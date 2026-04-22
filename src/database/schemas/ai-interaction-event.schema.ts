import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum AIFeatureKey {
  INVENTORY_QUERY = 'inventory_query',
  LEFTOVER_TRANSFORM = 'leftover_transform',
  RECIPE_GEN = 'recipe_gen',
  COOKBOOK_IMPORT = 'cookbook_import',
}

export enum AIResultType {
  RECIPE_GENERATED = 'recipe_generated',
  NO_RESULT = 'no_result',
  PARTIAL = 'partial',
  ERROR = 'error',
}

export enum AIUserAction {
  VIEWED = 'viewed',
  COOKED = 'cooked',
  SAVED = 'saved',
  IGNORED = 'ignored',
}

@Schema({ timestamps: { createdAt: true, updatedAt: true } })
export class AIInteractionEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AIFeatureKey),
    required: true,
    index: true,
  })
  feature: AIFeatureKey;

  @Prop({ type: String, default: 'unknown' })
  model: string;

  @Prop({ type: Number, default: 0, min: 0 })
  promptTokens: number;

  @Prop({ type: Number, default: 0, min: 0 })
  completionTokens: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalTokens: number;

  @Prop({ type: Number, default: 0, min: 0 })
  costUsd: number;

  @Prop({
    type: String,
    enum: Object.values(AIResultType),
    required: true,
    index: true,
  })
  resultType: AIResultType;

  @Prop({
    type: String,
    enum: Object.values(AIUserAction),
    default: null,
    index: true,
  })
  userAction: AIUserAction | null;

  @Prop({ type: Number, default: 0, min: 0 })
  latencyMs: number;

  @Prop({ type: Types.ObjectId, default: null, index: true })
  subjectId: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;

  updatedAt?: Date;
}

export type AIInteractionEventDocument = AIInteractionEvent & Document;
export const AIInteractionEventSchema =
  SchemaFactory.createForClass(AIInteractionEvent);

// Indexes for common analytics queries
AIInteractionEventSchema.index({ userId: 1, createdAt: -1 });
AIInteractionEventSchema.index({ feature: 1, createdAt: -1 });
AIInteractionEventSchema.index({ feature: 1, resultType: 1, createdAt: -1 });
AIInteractionEventSchema.index({ userId: 1, feature: 1, createdAt: -1 });
AIInteractionEventSchema.index({ userAction: 1, createdAt: -1 });
