import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class UserDietaryProfile {
  @Prop({ default: 'OMNI' })
  vegType: string;

  @Prop({ default: false })
  dairyFree: boolean;

  @Prop({ default: false })
  nutFree: boolean;

  @Prop({ default: false })
  glutenFree: boolean;

  @Prop({ default: false })
  hasDiabetes: boolean;

  @Prop({ type: [String], default: [] })
  otherAllergies: string[];
}

export const UserDietaryProfileSchema =
  SchemaFactory.createForClass(UserDietaryProfile);
