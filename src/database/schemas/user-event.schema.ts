import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum UserEventType {
  SIGNUP_COMPLETE = 'signup_complete',
  FIRST_RECIPE_OPENED = 'first_recipe_opened',
  FIRST_RECIPE_COOKED = 'first_recipe_cooked',
  FIRST_INGREDIENT_ADDED = 'first_ingredient_added',
  FIRST_MEAL_PLAN_CREATED = 'first_meal_plan_created',
  FIRST_SHOPPING_LIST_CREATED = 'first_shopping_list_created',
}

@Schema({ timestamps: false })
export class UserEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(UserEventType),
    required: true,
    index: true,
  })
  eventType: UserEventType;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export type UserEventDocument = UserEvent & Document;
export const UserEventSchema = SchemaFactory.createForClass(UserEvent);

UserEventSchema.index({ userId: 1, eventType: 1 }, { unique: true });
UserEventSchema.index({ eventType: 1, createdAt: -1 });
