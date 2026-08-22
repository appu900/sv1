import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { HeroImage, HeroImageSchema } from './hero-image.schema';
import { PerksMembershipPlan } from './perks-membership.schema';

/**
 * Screens that can host a promo card. Adding a value here is not enough on its
 * own — the app must also render a `<PromoSlot>` for it. Kept in sync with
 * `PROMO_PLACEMENTS` in the app's src/modules/promo/types.ts.
 */
export enum PromoPlacement {
  FEED_HOME = 'feed_home',
  SHOPPING_LIST = 'shopping_list',
  INVENTORY = 'inventory',
  COOKBOOK = 'cookbook',
  RECIPE_DETAIL = 'recipe_detail',
  MEAL_PLAN = 'meal_plan',
  MAKE_HOME = 'make_home',
  HACK_HOME = 'hack_home',
  TRACK_HOME = 'track_home',
  NUTRITION_HOME = 'nutrition_home',
  PERKS_DASHBOARD = 'perks_dashboard',
  GROUPS = 'groups',
}

export enum PromoAudienceMembership {
  ALL = 'all',
  MEMBER = 'member',
  NON_MEMBER = 'non_member',
}

export enum PromoPlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

export enum PromoImagePosition {
  LEFT = 'left',
  RIGHT = 'right',
}

/**
 * Every array here uses the "empty means any" convention: an empty `platforms`
 * matches iOS and Android alike. This keeps a card that targets nothing in
 * particular from having to enumerate every possible value.
 */
@Schema({ _id: false })
export class PromoAudience {
  @Prop({
    type: String,
    enum: PromoAudienceMembership,
    default: PromoAudienceMembership.ALL,
  })
  membership: PromoAudienceMembership;

  @Prop({ type: [String], enum: PerksMembershipPlan, default: [] })
  plans: PerksMembershipPlan[];

  /** ISO-3166-1 alpha-2, uppercased on write. */
  @Prop({ type: [String], default: [] })
  countries: string[];

  @Prop({ type: [String], enum: PromoPlatform, default: [] })
  platforms: PromoPlatform[];

  @Prop({ type: String, default: null })
  minAppVersion: string | null;

  @Prop({ type: String, default: null })
  maxAppVersion: string | null;
}

export const PromoAudienceSchema = SchemaFactory.createForClass(PromoAudience);

@Schema({ _id: false })
export class PromoSchedule {
  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @Prop({ type: Date, default: null })
  endsAt: Date | null;
}

export const PromoScheduleSchema = SchemaFactory.createForClass(PromoSchedule);

@Schema({ _id: false })
export class PromoContent {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ required: true, trim: true })
  ctaLabel: string;

  /**
   * App-relative deep link path, e.g. `/perks/calculator`. Chosen in the admin
   * panel from `APP_DEEP_LINK_ROUTES`, and resolved on device by
   * `applyDeepLinkPath`, so no per-placement navigation code is needed.
   */
  @Prop({ required: true, trim: true })
  ctaDeepLink: string;

  @Prop({ type: HeroImageSchema, default: null })
  image: HeroImage | null;
}

export const PromoContentSchema = SchemaFactory.createForClass(PromoContent);

/**
 * Fully admin-controlled presentation. Deliberately not constrained to the
 * Saveful palette — the admin editor renders a live preview and warns on poor
 * contrast rather than restricting the colours available.
 */
@Schema({ _id: false })
export class PromoStyle {
  @Prop({ default: '#4B2176' })
  backgroundColor: string;

  /** When both stops are set the card renders a LinearGradient instead of a solid fill. */
  @Prop({ type: String, default: null })
  gradientFrom: string | null;

  @Prop({ type: String, default: null })
  gradientTo: string | null;

  @Prop({ default: '#AB84FF' })
  borderColor: string;

  @Prop({ default: 2.5 })
  borderWidth: number;

  @Prop({ default: 16 })
  cornerRadius: number;

  @Prop({ default: '#FFFCF9' })
  titleColor: string;

  @Prop({ default: '#FFFCF9' })
  bodyColor: string;

  @Prop({ default: '#4B2176' })
  ctaTextColor: string;

  @Prop({ default: '#FFFCF9' })
  ctaBackgroundColor: string;

  @Prop({
    type: String,
    enum: PromoImagePosition,
    default: PromoImagePosition.LEFT,
  })
  imagePosition: PromoImagePosition;
}

export const PromoStyleSchema = SchemaFactory.createForClass(PromoStyle);

@Schema({ _id: false })
export class PromoBehaviour {
  @Prop({ default: true })
  dismissible: boolean;

  /** Days before a dismissed card may reappear. 0 means never. */
  @Prop({ default: 0, min: 0 })
  reshowAfterDays: number;

  /** Row index a list placement inserts the card above. Clamped on device. */
  @Prop({ default: 0, min: 0 })
  slotIndex: number;
}

export const PromoBehaviourSchema =
  SchemaFactory.createForClass(PromoBehaviour);

@Schema({ timestamps: true })
export class PromoCard {
  /** Admin-facing label. Never rendered in the app. */
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, enum: PromoPlacement, required: true, index: true })
  placement: PromoPlacement;

  /** Higher wins when several cards match the same placement. */
  @Prop({ default: 0 })
  priority: number;

  @Prop({ default: false, index: true })
  isActive: boolean;

  @Prop({ type: PromoAudienceSchema, default: () => ({}) })
  audience: PromoAudience;

  @Prop({ type: PromoScheduleSchema, default: () => ({}) })
  schedule: PromoSchedule;

  @Prop({ type: PromoContentSchema, required: true })
  content: PromoContent;

  @Prop({ type: PromoStyleSchema, default: () => ({}) })
  style: PromoStyle;

  @Prop({ type: PromoBehaviourSchema, default: () => ({}) })
  behaviour: PromoBehaviour;
}

export type PromoCardDocument = PromoCard & Document;
export const PromoCardSchema = SchemaFactory.createForClass(PromoCard);

// The read path always filters on isActive + placement and orders by priority.
PromoCardSchema.index({ isActive: 1, placement: 1, priority: -1 });
