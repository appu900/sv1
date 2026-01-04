import { Module } from '@nestjs/common';
import { CommunityGroupsService } from './community-groups.service';
import { CommunityGroupsController } from './community-groups.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunityGroups, CommunityGroupSchema } from 'src/database/schemas/community.groups.schema';

@Module({
  imports:[MongooseModule.forFeature([
    {name:CommunityGroups.name,schema:CommunityGroupSchema}
  ])],
  controllers: [CommunityGroupsController],
  providers: [CommunityGroupsService],
})
export class CommunityGroupsModule {}
