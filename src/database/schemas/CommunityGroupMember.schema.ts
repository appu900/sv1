import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum GroupMemberRole {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER',
}



@Schema({timestamps:true})
export class CommunityGroupMember {
  @Prop({ type: Types.ObjectId, ref: 'CommunityGroup', required: true })
  groupId:Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: GroupMemberRole,
    default: GroupMemberRole.MEMBER,
  })
  role: GroupMemberRole;

  @Prop({ default: true })
  isActive:boolean;


  @Prop({default:false})
  reJoined:boolean;

  @Prop({})
  joinedViaCode?: string;
}



export type CommunityGroupMemberDocument = CommunityGroupMember & Document
export const CommunityGroupMemberSchema = SchemaFactory.createForClass(CommunityGroupMember)

CommunityGroupMemberSchema.index({groupId:1,userId:1})
CommunityGroupMemberSchema.index({userId:1})
CommunityGroupMemberSchema.index({groupId:1})


