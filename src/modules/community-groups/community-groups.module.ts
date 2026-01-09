import { Module } from '@nestjs/common';
import { CommunityGroupsService } from './community-groups.service';
import { CommunityGroupsController } from './community-groups.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunityGroups, CommunityGroupSchema } from 'src/database/schemas/community.groups.schema';
import { CommunityGroupMember, CommunityGroupMemberSchema } from 'src/database/schemas/CommunityGroupMember.schema';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { CommunityChallenge, CommunityChallengesSchema } from 'src/database/schemas/challenge.schema';
import { CommunityChallengeParticipant, CommunityChallengeParticipantSchema } from 'src/database/schemas/challenge.members.schema';

@Module({
  imports:[MongooseModule.forFeature([
    {name:CommunityGroups.name,schema:CommunityGroupSchema},
    {name:CommunityGroupMember.name,schema:CommunityGroupMemberSchema},
    {name:User.name,schema:UserSchema},
    {name:CommunityChallenge.name,schema:CommunityChallengesSchema},
    {name:CommunityChallengeParticipant.name,schema:CommunityChallengeParticipantSchema}
  ])],
  controllers: [CommunityGroupsController],
  providers: [CommunityGroupsService],
})
export class CommunityGroupsModule {}
