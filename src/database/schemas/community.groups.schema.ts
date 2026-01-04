import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({timestamps:true})
export class CommunityGroups {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ })
  profilePhotoUrl?: string;

  @Prop({ required: true, trim: true,index:true })
  joinCode: string;

  @Prop({ type:Types.ObjectId,ref:'User',required:true})
  ownerId: string;

  @Prop({ default:1 })
  memberCount: number;

  @Prop({})
  totalFoodSaved?: number;

  @Prop({ default:false })
  isDeleted: boolean;
}


export type CommunityGroupDocument = CommunityGroups & Document
export const CommunityGroupSchema = SchemaFactory.createForClass(CommunityGroups)
