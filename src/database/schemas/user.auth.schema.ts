import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserDietaryProfile } from './user-dietary-profile.schema';
import { UserSavefulPreferences } from './user-saveful-preferences.schema';
import { Gender } from './nutrition/health-profile.schema';

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  CHEF = 'CHEF',
}
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop()
  role:UserRole

  @Prop()
  stateCode?:string;

  @Prop({})
  country?:string

  @Prop({})
  timezone?:string

  @Prop({})
  pincode?:string

  /** True after offline pincode→state backfill processed this user. */
  @Prop({ default: false, index: true })
  stateCheckDone?: boolean;

  @Prop({ type: Date, default: null })
  stateCheckedAt?: Date | null;

  @Prop({ trim: true })
  phoneNumber?: string;

  @Prop({ type: String, enum: Gender })
  gender?: Gender;

  @Prop({default:true})
  isUserSubscribed?:boolean

  @Prop({type:UserDietaryProfile})
  dietaryProfile?:UserDietaryProfile

  @Prop({ type: UserSavefulPreferences })
  savefulPreferences?: UserSavefulPreferences;
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);
