import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';


export enum StorageLocation {
  PANTRY = 'pantry',
  FRIDGE = 'fridge',
  FREEZER = 'freezer',
  OTHER = 'other',
}

export enum FreshnessStatus {
  FRESH = 'fresh',
  EXPIRING_SOON = 'expiring_soon',
  EXPIRED = 'expired',
}

export enum WasteType {
  WET = 'wet_waste',
  DRY = 'dry_waste',
  HAZARDOUS = 'hazardous',
}

export enum DiscardReason {
  EXPIRED = 'expired',
  SPOILED = 'spoiled',
  LEFTOVER = 'leftover',
  UNUSED = 'unused',
  COOKED = 'cooked',
}

export enum InventoryItemSource {
  MANUAL = 'manual',
  VOICE = 'voice',
  SHOPPING_LIST = 'shopping_list',
  RECIPE = 'recipe',
}


@Schema({ timestamps: true })
export class UserInventoryItem {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ingredient' })
  ingredientId?: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 0 })
  quantity: number;

  @Prop({ required: true })
  unit: string; 

  @Prop({
    type: String,
    enum: Object.values(StorageLocation),
    default: StorageLocation.PANTRY,
  })
  storageLocation: StorageLocation;

  @Prop({
    type: String,
    enum: Object.values(FreshnessStatus),
    default: FreshnessStatus.FRESH,
  })
  freshnessStatus: FreshnessStatus;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date, default: Date.now })
  addedAt: Date;

  @Prop({
    type: String,
    enum: Object.values(InventoryItemSource),
    default: InventoryItemSource.MANUAL,
  })
  source: InventoryItemSource;


  @Prop({ default: false })
  isDiscarded: boolean;

  @Prop({ type: String, enum: Object.values(WasteType) })
  wasteType?: WasteType;

  @Prop({ type: String, enum: Object.values(DiscardReason) })
  discardReason?: DiscardReason;

  @Prop()
  discardNotes?: string;

  @Prop({ type: Date })
  discardedAt?: Date;

  @Prop({ type: Number, min: 0 })
  discardedQuantity?: number;


  @Prop({ type: [String], default: [] })
  countries: string[];

  @Prop()
  heroImageUrl?: string;

  @Prop({ type: Types.ObjectId, ref: 'IngredientsCategory' })
  categoryId?: Types.ObjectId;

  @Prop({ default: false })
  isStaple: boolean; 

  @Prop({ type: Number, default: 0, index: true })
  position: number;
}

export type UserInventoryItemDocument = UserInventoryItem & Document;
export const UserInventoryItemSchema =
  SchemaFactory.createForClass(UserInventoryItem);


UserInventoryItemSchema.index({ userId: 1, isDiscarded: 1 });
UserInventoryItemSchema.index({ userId: 1, storageLocation: 1 });
UserInventoryItemSchema.index({ userId: 1, expiresAt: 1 });
UserInventoryItemSchema.index({ userId: 1, freshnessStatus: 1 });
UserInventoryItemSchema.index({ userId: 1, ingredientId: 1 });
UserInventoryItemSchema.index({ expiresAt: 1, isDiscarded: 1 }); 
