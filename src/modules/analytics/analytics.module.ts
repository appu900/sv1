import { Global, Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsListner } from './analytics.listener';
import { MongooseModule } from '@nestjs/mongoose';
import { UserFoodAnalyticalProfileSchema, UserFoodAnalyticsProfile } from 'src/database/schemas/user.food.analyticsProfile.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';
import { CommunityGroups, CommunityGroupSchema } from 'src/database/schemas/community.groups.schema';
import { CommunityGroupMember, CommunityGroupMemberSchema } from 'src/database/schemas/CommunityGroupMember.schema';
import { CommunityChallenge, CommunityChallengesSchema } from 'src/database/schemas/challenge.schema';
import { CommunityChallengeParticipant, CommunityChallengeParticipantSchema } from 'src/database/schemas/challenge.members.schema';

@Global()
@Module({
  imports: [MongooseModule.forFeature([
    {name:UserFoodAnalyticsProfile.name,schema:UserFoodAnalyticalProfileSchema},
    {name:Ingredient.name,schema:IngredientSchema},
    {name:CommunityGroups.name,schema:CommunityGroupSchema},
    {name:CommunityGroupMember.name,schema:CommunityGroupMemberSchema},
    {name:CommunityChallenge.name,schema:CommunityChallengesSchema},
    {name:CommunityChallengeParticipant.name,schema:CommunityChallengeParticipantSchema},
  ])],
  providers: [AnalyticsService,AnalyticsListner],
  controllers: [AnalyticsController],
  exports:[]
})
export class AnalyticsModule {}
