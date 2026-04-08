import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SharedRecipeController } from './shared-recipe.controller';
import { SharedRecipeService } from './shared-recipe.service';
import {
  SharedRecipe,
  SharedRecipeSchema,
} from 'src/database/schemas/shared-recipe.schema';
import {
  SharedRecipeLike,
  SharedRecipeLikeSchema,
} from 'src/database/schemas/shared-recipe-like.schema';
import {
  userRecipe,
  UserRecipeSchema,
} from 'src/database/schemas/user.schema';
import {
  CommunityGroupMember,
  CommunityGroupMemberSchema,
} from 'src/database/schemas/CommunityGroupMember.schema';
import {
  CommunityGroups,
  CommunityGroupSchema,
} from 'src/database/schemas/community.groups.schema';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SharedRecipe.name, schema: SharedRecipeSchema },
      { name: SharedRecipeLike.name, schema: SharedRecipeLikeSchema },
      { name: userRecipe.name, schema: UserRecipeSchema },
      { name: CommunityGroupMember.name, schema: CommunityGroupMemberSchema },
      { name: CommunityGroups.name, schema: CommunityGroupSchema },
    ]),
    NotificationModule,
  ],
  controllers: [SharedRecipeController],
  providers: [SharedRecipeService],
  exports: [SharedRecipeService],
})
export class SharedRecipeModule {}
