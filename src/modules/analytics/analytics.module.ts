import { Global, Module, forwardRef } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsListner } from './analytics.listener';
import { AppSessionListener } from './app-session.listener';
import { MongooseModule } from '@nestjs/mongoose';
import { UserFoodAnalyticalProfileSchema, UserFoodAnalyticsProfile } from 'src/database/schemas/user.food.analyticsProfile.schema';
import { Ingredient, IngredientSchema } from 'src/database/schemas/ingredient.schema';
import { CommunityGroups, CommunityGroupSchema } from 'src/database/schemas/community.groups.schema';
import { CommunityGroupMember, CommunityGroupMemberSchema } from 'src/database/schemas/CommunityGroupMember.schema';
import { CommunityChallenge, CommunityChallengesSchema } from 'src/database/schemas/challenge.schema';
import { CommunityChallengeParticipant, CommunityChallengeParticipantSchema } from 'src/database/schemas/challenge.members.schema';
import { Recipe, RecipeSchema } from 'src/database/schemas/recipe.schema';
import { Feedback, FeedbackSchema } from 'src/database/schemas/feedback.schema';
import { BadgesModule } from '../badges/badges.module';
import { User,UserSchema } from 'src/database/schemas/user.auth.schema';
import { LeaderboardProfile, LeaderboardProfileSchema } from 'src/database/schemas/leaderboard-profile.schema';
import { FoodSavedEventLog, FoodSavedEventLogSchema } from 'src/database/schemas/food-saved-event-log.schema';
import { UserBadge, UserBadgeSchema } from 'src/database/schemas/user-badge.schema';
import { IngredientSearchEvent, IngredientSearchEventSchema } from 'src/database/schemas/ingredient-search-event.schema';
import { ClientAnalyticsEvent, ClientAnalyticsEventSchema } from 'src/database/schemas/client-analytics-event.schema';
import { MetricsService } from './metrics.service';
import { AiImpactService } from './ai-impact.service';
import { ChefModule } from '../chef/chef.module';
import { SurveyConfigModule } from '../survey-config/survey-config.module';
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      {name:UserFoodAnalyticsProfile.name,schema:UserFoodAnalyticalProfileSchema},
      {name:Ingredient.name,schema:IngredientSchema},
      {name:CommunityGroups.name,schema:CommunityGroupSchema},
      {name:CommunityGroupMember.name,schema:CommunityGroupMemberSchema},
      {name:CommunityChallenge.name,schema:CommunityChallengesSchema},
      {name:CommunityChallengeParticipant.name,schema:CommunityChallengeParticipantSchema},
      {name:Recipe.name,schema:RecipeSchema},
      {name:Feedback.name,schema:FeedbackSchema},
      {name:User.name,schema:UserSchema},
      {name:LeaderboardProfile.name,schema:LeaderboardProfileSchema},
      {name:FoodSavedEventLog.name,schema:FoodSavedEventLogSchema},
      {name:UserBadge.name,schema:UserBadgeSchema},
      {name:IngredientSearchEvent.name,schema:IngredientSearchEventSchema},
      {name:ClientAnalyticsEvent.name,schema:ClientAnalyticsEventSchema},
    ]),
    SurveyConfigModule,
    forwardRef(() => BadgesModule),
    forwardRef(() => ChefModule),
  ],
  providers: [AnalyticsService, MetricsService, AiImpactService, AnalyticsListner, AppSessionListener],
  controllers: [AnalyticsController],
  exports:[AnalyticsService, MetricsService, AiImpactService]
})
export class AnalyticsModule {}
