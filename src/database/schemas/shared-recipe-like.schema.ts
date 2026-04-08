import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class SharedRecipeLike {
  @Prop({ type: Types.ObjectId, ref: 'SharedRecipe', required: true })
  sharedRecipeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}

export type SharedRecipeLikeDocument = SharedRecipeLike & Document;
export const SharedRecipeLikeSchema = SchemaFactory.createForClass(SharedRecipeLike);

SharedRecipeLikeSchema.index({ sharedRecipeId: 1, userId: 1 }, { unique: true });
SharedRecipeLikeSchema.index({ userId: 1 });
