import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserDietaryProfile } from './user-dietary-profile.schema';

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  CHEF = 'CHEF',
}
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
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

  @Prop({type:UserDietaryProfile})
  dietaryProfile?:UserDietaryProfile
}

export type UserDocument = User & Document;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({email:1})
UserSchema.index({phoneNumber:1},{sparse:true})
