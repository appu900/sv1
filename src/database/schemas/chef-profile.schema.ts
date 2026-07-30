import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class ChefSocialLinks {
  @Prop()
  instagram?: string;

  @Prop()
  youtube?: string;

  @Prop()
  tiktok?: string;

  @Prop()
  facebook?: string;

  @Prop()
  website?: string;

  @Prop()
  linkedin?: string;
}

@Schema({ _id: false })
export class ChefLifetimeImpact {
  @Prop({ type: Number, default: 0, min: 0 })
  mealsCooked: number;

  @Prop({ type: Number, default: 0, min: 0 })
  moneySaved: number;

  @Prop({ type: Map, of: Number, default: {} })
  moneyByCurrency: Map<string, number>;

  @Prop({ type: Number, default: 0, min: 0 })
  foodSavedInGrams: number;

  @Prop({ type: Number, default: 0, min: 0 })
  co2SavedInGrams: number;
}

@Schema({ _id: false })
export class ChefPaymentDetails {
  @Prop({
    type: String,
    enum: ['not_collected', 'pending', 'verified'],
    default: 'not_collected',
  })
  status: string;

  @Prop({ type: String, default: null })
  accountName?: string | null;

  @Prop({ type: String, default: null })
  bankName?: string | null;

  @Prop({ type: String, default: null })
  accountNumberLast4?: string | null;

  @Prop({ type: String, default: null })
  bsbOrRouting?: string | null;

  @Prop({ type: String, default: null })
  currency?: string | null;
}

@Schema({ timestamps: true })
export class ChefProfile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  displayName: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  displayNameLower: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  slug: string;

  @Prop({ trim: true })
  country?: string;

  @Prop()
  avatarImageUrl?: string;

  @Prop()
  heroImageUrl?: string;

  @Prop({ maxlength: 240 })
  quote?: string;

  @Prop({ maxlength: 4000 })
  bio?: string;

  @Prop({ type: ChefSocialLinks, default: {} })
  socialLinks: ChefSocialLinks;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Cuisine' }], default: [] })
  cuisineIds: Types.ObjectId[];

  /** Chef-authored cuisine inspiration (max 3). Separate from recipe-derived cuisineIds. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Cuisine' }], default: [] })
  featuredCuisineIds: Types.ObjectId[];

  // Private contact — never expose on public /chefs APIs
  @Prop({ trim: true, lowercase: true })
  contactEmail?: string;

  @Prop({ trim: true })
  mobileNumber?: string;

  @Prop({ trim: true })
  preferredContactName?: string;

  @Prop({ trim: true })
  organisation?: string;

  @Prop({ type: ChefPaymentDetails, default: () => ({ status: 'not_collected' }) })
  paymentDetails: ChefPaymentDetails;

  @Prop({
    type: String,
    enum: ['draft', 'pending_review', 'approved', 'rejected'],
    default: 'draft',
    index: true,
  })
  onboardingStatus: string;

  @Prop({ type: Number, default: 0, min: 0, max: 7 })
  onboardingStep: number;

  @Prop({ type: Date, default: null })
  submittedForReviewAt?: Date | null;

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  reviewNote?: string;

  @Prop({ type: String, default: null })
  agreementAcceptedVersion?: string | null;

  @Prop({ type: Date, default: null })
  agreementAcceptedAt?: Date | null;

  @Prop({ default: false, index: true })
  isPublished: boolean;

  @Prop({ default: 0 })
  order: number;

  @Prop({ type: Number, default: 0, min: 0 })
  favouriteCount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  publishedRecipeCount: number;

  @Prop({ type: Date, default: null })
  firstPublishedAt?: Date | null;

  @Prop({ type: ChefLifetimeImpact, default: () => ({}) })
  lifetime: ChefLifetimeImpact;
}

export type ChefProfileDocument = ChefProfile & Document;
export const ChefProfileSchema = SchemaFactory.createForClass(ChefProfile);

ChefProfileSchema.index({ isPublished: 1, order: 1, _id: 1 });
ChefProfileSchema.index({ isPublished: 1, displayNameLower: 1 });
ChefProfileSchema.index({ isPublished: 1, cuisineIds: 1, order: 1 });
ChefProfileSchema.index({ isPublished: 1, featuredCuisineIds: 1, order: 1 });
ChefProfileSchema.index({ isPublished: 1, 'lifetime.mealsCooked': -1 });
ChefProfileSchema.index({ onboardingStatus: 1, submittedForReviewAt: -1 });
