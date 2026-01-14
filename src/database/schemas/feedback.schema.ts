import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Feedback {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  framework_id: string;

  @Prop({ type: Boolean, default: false })
  prompted: boolean;

  @Prop({ type: Object })
  data: {
    did_you_like_it?: boolean;
    food_saved?: number;
    meal_id?: string;
    rating?: number; // 1-5 carrot rating
    review?: string; // Optional text review
  };

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type FeedbackDocument = Feedback & Document;
export const FeedbackSchema = SchemaFactory.createForClass(Feedback);

// Index for querying user feedbacks
FeedbackSchema.index({ userId: 1, createdAt: -1 });
// Index for querying by meal
FeedbackSchema.index({ 'data.meal_id': 1 });
