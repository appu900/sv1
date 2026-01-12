import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({timestamps:true})
export class CommunityChallenge{
    @Prop({type:Types.ObjectId,ref:'CommunityGroups',required:true,index:true})
    communityId:Types.ObjectId;

    @Prop({type:Types.ObjectId,ref:'User',required:true,index:true})
    createdBy:Types.ObjectId

    @Prop({required:true})
    challengeName:string;

    @Prop({required:true})
    challengeGoal:number

    @Prop({required:true})
    startDate:Date

    @Prop({required:true})
    endDate:Date

    @Prop({required:true})
    description:string;
    
    @Prop({default:true,index:true})
    status:boolean



    @Prop({default:1})
    memberCount:number;

    @Prop({default:0})
    totalFoodSaved:number;
   
    @Prop({default:false,index:true})
    isDeleted:boolean

    @Prop({default:0.0})
    foodSaved:number;
}


export type CommunityChallengeDocument = CommunityChallenge & Document
export const CommunityChallengesSchema = SchemaFactory.createForClass(CommunityChallenge)