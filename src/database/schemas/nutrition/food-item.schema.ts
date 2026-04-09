import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum FoodSource {
  IFCT = 'ifct',
  USDA = 'usda',
  OPEN_FOOD_FACTS = 'openfoodfacts',
  CALORIE_NINJAS = 'calorie_ninjas',
  AI = 'ai',
  USER_CONTRIBUTED = 'user_contributed',
  MANUAL = 'manual',
}

export enum FoodCategory {
  FRUIT = 'fruit',
  VEGETABLE = 'vegetable',
  GRAIN = 'grain',
  LEGUME = 'legume',
  DAIRY = 'dairy',
  PROTEIN = 'protein',
  FAT_OIL = 'fat_oil',
  BEVERAGE = 'beverage',
  SNACK = 'snack',
  SWEET = 'sweet',
  PACKAGED = 'packaged',
  DISH = 'dish',
  CONDIMENT = 'condiment',
  OTHER = 'other',
}

@Schema({ _id: false })
export class ServingOption {
  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, min: 0 })
  grams: number;

  @Prop({ default: false })
  isDefault?: boolean;
}
export const ServingOptionSchema = SchemaFactory.createForClass(ServingOption);

@Schema({ _id: false })
export class NutritionPer100g {
  @Prop({ required: true, min: 0 })
  kcal: number;

  @Prop({ default: 0, min: 0 })
  protein_g: number;

  @Prop({ default: 0, min: 0 })
  carbs_g: number;

  @Prop({ default: 0, min: 0 })
  fat_g: number;

  @Prop({ default: 0, min: 0 })
  fiber_g: number;

  @Prop({ default: 0, min: 0 })
  sugar_g: number;

  @Prop({ default: 0, min: 0 })
  sodium_mg: number;
}
export const NutritionPer100gSchema =
  SchemaFactory.createForClass(NutritionPer100g);

@Schema({ timestamps: true, collection: 'food_items' })
export class FoodItem {
  /** Normalized lower-case canonical name, e.g. "banana". */
  @Prop({ required: true, trim: true, lowercase: true })
  canonicalName: string;

  /** Human display name, e.g. "Banana". */
  @Prop({ required: true, trim: true })
  displayName: string;

  /** Alternate spellings / local names for fuzzy search. */
  @Prop({ type: [String], default: [] })
  aliases: string[];

  /** Brand for packaged foods, null for generics. */
  @Prop({ type: String, trim: true, default: null })
  brand?: string | null;

  /** EAN/UPC barcode when available. Unique when present. */
  @Prop({ type: String, trim: true, default: null })
  barcode?: string | null;

  /** S3 URL of the product image (photo of packaging/label). */
  @Prop({ type: String, trim: true, default: null })
  imageUrl?: string | null;

  @Prop({
    type: String,
    enum: FoodCategory,
    default: FoodCategory.OTHER,
    index: true,
  })
  category: FoodCategory;

  /** Ordered list of portion options. First with isDefault=true is the UI default. */
  @Prop({ type: [ServingOptionSchema], default: [] })
  servingOptions: ServingOption[];

  /** Density for volume → grams conversion. Defaults to 1.0 (water) if absent. */
  @Prop({ type: Number, min: 0, default: null })
  gramsPerMl?: number | null;

  @Prop({ type: NutritionPer100gSchema, required: true })
  per100g: NutritionPer100g;

  @Prop({
    type: String,
    enum: FoodSource,
    default: FoodSource.MANUAL,
    index: true,
  })
  source: FoodSource;

  /** 0..1 — 1.0 means lab-verified, 0.5 means AI-estimated, etc. */
  @Prop({ min: 0, max: 1, default: 0.7 })
  confidence: number;

  @Prop({ default: false, index: true })
  verified: boolean;

  /** ISO country code or "global". Used to rank local results first. */
  @Prop({ trim: true, default: 'global', index: true })
  locale: string;

  /** For user-contributed foods; null for catalog entries. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ default: true })
  isPublic: boolean;
}

export type FoodItemDocument = FoodItem & Document;
export const FoodItemSchema = SchemaFactory.createForClass(FoodItem);

// Text search across name/aliases/brand. Weights favor canonical name.
FoodItemSchema.index(
  { canonicalName: 'text', aliases: 'text', brand: 'text', displayName: 'text' },
  {
    weights: { canonicalName: 10, displayName: 8, aliases: 5, brand: 3 },
    name: 'food_item_text_index',
  },
);

// Fast prefix lookups for autocomplete (case-insensitive via lowercase prop).
FoodItemSchema.index({ canonicalName: 1 });

// Barcode lookups. Sparse so many null barcodes are allowed; unique when set.
FoodItemSchema.index(
  { barcode: 1 },
  { unique: true, sparse: true, name: 'food_item_barcode_unique' },
);

FoodItemSchema.index({ locale: 1, verified: -1, canonicalName: 1 });
