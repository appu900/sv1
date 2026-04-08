import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ShareType {
  COMMUNITY = 'community',
  PUBLIC = 'public',
}

@Schema({ timestamps: true })
export class SharedRecipe {
  @Prop({ type: Types.ObjectId, ref: 'userRecipe', required: true })
  recipeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedBy: Types.ObjectId;

  @Prop({ type: String, enum: ShareType, required: true })
  shareType: ShareType;

  /** Only set when shareType === 'community' */
  @Prop({ type: Types.ObjectId, ref: 'CommunityGroups', default: null })
  communityId?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 300, default: '' })
  message: string;

  @Prop({ default: 0 })
  likesCount: number;

  @Prop({ default: 0 })
  savesCount: number;

  @Prop({ default: true })
  isActive: boolean;
}

export type SharedRecipeDocument = SharedRecipe & Document;
export const SharedRecipeSchema = SchemaFactory.createForClass(SharedRecipe);

// Indexes for efficient lookups
SharedRecipeSchema.index({ communityId: 1, isActive: 1, createdAt: -1 });
SharedRecipeSchema.index({ shareType: 1, isActive: 1, createdAt: -1 });
SharedRecipeSchema.index({ sharedBy: 1, recipeId: 1, shareType: 1, communityId: 1 }, { unique: true });
SharedRecipeSchema.index({ sharedBy: 1, isActive: 1 });
