import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
enum UserStatus {
    ACCEPTED = 'accepted',
    PENDING = 'pending',
    REJECTED = 'rejected',
}
@Schema({ _id: false })
export class AlternativeIngredient {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: false })
  ingredient?: Types.ObjectId;

  @Prop()
  ingredientName?: string;

  @Prop({ default: false })
  inheritQuantity: boolean;

  @Prop({ default: false })
  inheritPreparation: boolean;

  @Prop()
  quantity?: string;

  @Prop()
  preparation?: string;
}


@Schema({ _id: false })
export class RequiredIngredient {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: false })
  recommendedIngredient?: Types.ObjectId;

  @Prop()
  ingredientName?: string;

  @Prop()
  quantity: string;

  @Prop()
  preparation: string;

  @Prop({ type: [AlternativeIngredient], default: [] })
  alternativeIngredients: AlternativeIngredient[];
}

@Schema({ _id: false })
export class OptionalIngredient {
  @Prop({ type: Types.ObjectId, ref: 'Ingredient', required: false })
  ingredient?: Types.ObjectId;

  @Prop()
  ingredientName?: string;

  @Prop()
  quantity: string;

  @Prop()
  preparation: string;
}

@Schema({ _id: false })
export class ComponentStep {
  @Prop()
  stepInstructions: string; 

  @Prop({ type: [{ type: Types.ObjectId, ref: 'HackOrTip' }], default: [] })
  hackOrTipIds: Types.ObjectId[];

  @Prop({ default: false })
  alwaysShow: boolean;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Ingredient' }], default: [] })
  relevantIngredients: Types.ObjectId[];
}

@Schema({ _id: false })
export class Component {
  @Prop(
    
  )
  componentTitle: string; 

  @Prop()
  componentInstructions?: string;

  @Prop({ type: [String], default: [] })
  includedInVariants: string[];

  @Prop({ type: [RequiredIngredient], default: [] })
  requiredIngredients: RequiredIngredient[];

  @Prop({ type: [OptionalIngredient], default: [] })
  optionalIngredients: OptionalIngredient[];

  @Prop({ type: [ComponentStep], default: [] })
  componentSteps: ComponentStep[];
}


@Schema({ _id: false })
export class RecipeComponentWrapper {

  @Prop()
  prepShortDescription?: string;

  @Prop()
  prepLongDescription?: string; 

  @Prop({ type: [String], default: [] })
  variantTags: string[];

  @Prop({ default: false })
  stronglyRecommended: boolean;

  @Prop()
  choiceInstructions?: string; 

  @Prop()
  buttonText?: string; 

  @Prop({ type: [Component] })
  component: Component[];
}

@Schema({ timestamps: true })
export class userRecipe {
  @Prop()
  title: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userid: Types.ObjectId;

  @Prop({ enum: Object.values(UserStatus), default: UserStatus.PENDING })
  status: UserStatus;

  @Prop()
  shortDescription: string;

  @Prop()
  longDescription: string; 

  @Prop({ type: [{ type: Types.ObjectId, ref: 'HackOrTip' }], default: [] })
  hackOrTipIds: Types.ObjectId[];

  @Prop()
  heroImageUrl?: string; 

  @Prop()
  youtubeId?: string;

  @Prop()
  portions: string; 

  @Prop()
  prepCookTime: number; 

  @Prop({ type: Types.ObjectId, ref: 'Stickers' })
  stickerId?: Types.ObjectId;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'FrameworkCategory' }],
  })
  frameworkCategories: Types.ObjectId[]; 

  @Prop({ type: Types.ObjectId, ref: 'Sponsers' })
  sponsorId?: Types.ObjectId;

  @Prop()
  fridgeKeepTime?: string;

  @Prop()
  freezeKeepTime?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Recipe' }], default: [] })
  useLeftoversIn: Types.ObjectId[];

 
  @Prop({ type: [RecipeComponentWrapper] })
  components: RecipeComponentWrapper[];

  @Prop({ default: 0 })
  order?: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: [String], default: [] })
  countries: string[];

  @Prop({ type: String, enum: ['link', 'ai_ingredients'], default: 'link' })
  source: string;
}

export type UserRecipeDocument = userRecipe & Document;
export const UserRecipeSchema = SchemaFactory.createForClass(userRecipe);

UserRecipeSchema.index({ title: 1 });
UserRecipeSchema.index({ frameworkCategories: 1 });
UserRecipeSchema.index({ isActive: 1 });
UserRecipeSchema.index({ order: 1 });