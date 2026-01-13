import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
@Schema({ timestamps: true })
export class CommunityChallengeParticipant {
  @Prop({
    type: Types.ObjectId,
    ref: 'CommunityChallenge',
    required: true,
    index: true,
  })
  challengeId: Types.ObjectId;

  @Prop({required:true,index:true,type:Types.ObjectId,ref:'CommunityGroups'})
  communityId:Types.ObjectId

  @Prop({required:true,type:Types.ObjectId,ref:'User',index:true})
  userId:Types.ObjectId

  @Prop({default:0})
  foodSaved:number;

  // Total meals completed by participant in this challenge
  @Prop({default:0})
  totalMealsCompleted:number;

  @Prop({default:true})
  isActive:boolean
}



export type CommunityChallengeParticipantDocument = CommunityChallengeParticipant & Document;
export const CommunityChallengeParticipantSchema = SchemaFactory.createForClass(CommunityChallengeParticipant)


