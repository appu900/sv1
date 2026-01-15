import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ShoppingListItemSource {
  RECIPE = 'RECIPE', 
  MANUAL = 'MANUAL',
}

export enum ShoppingListItemStatus {
  PENDING = 'PENDING', 
  PURCHASED = 'PURCHASED',
}

@Schema({ _id: false })
export class ShoppingListItemData {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient' })
  ingredientId?: Types.ObjectId;

  @Prop()
  ingredientName?: string;

  @Prop()
  quantity?: string;

  @Prop()
  unit?: string;

  @Prop({ 
    type: String, 
    enum: Object.values(ShoppingListItemSource), 
    default: ShoppingListItemSource.MANUAL 
  })
  source: ShoppingListItemSource;

  @Prop({ 
    type: String, 
    enum: Object.values(ShoppingListItemStatus), 
    default: ShoppingListItemStatus.PENDING 
  })
  status: ShoppingListItemStatus;

  @Prop({ type: Types.ObjectId, ref: 'Recipe' })
  recipeId?: Types.ObjectId;

  @Prop()
  notes?: string;

  @Prop({ type: Date })
  purchasedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  addedAt: Date;
}

export const ShoppingListItemDataSchema = SchemaFactory.createForClass(ShoppingListItemData);

@Schema({ timestamps: true })
export class ShoppingList {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: [ShoppingListItemDataSchema], default: [] })
  items: ShoppingListItemData[];

  @Prop({ default: false })
  isArchived: boolean;

  @Prop({ type: Date })
  archivedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type ShoppingListDocument = ShoppingList & Document;
export const ShoppingListSchema = SchemaFactory.createForClass(ShoppingList);

ShoppingListSchema.index({ userId: 1, isArchived: 1, createdAt: -1 });

