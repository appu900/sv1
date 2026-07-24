import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import { memoryStorage } from 'multer';
import {
  ChefProfile,
  ChefProfileSchema,
} from '../../database/schemas/chef-profile.schema';
import {
  ChefFavourite,
  ChefFavouriteSchema,
} from '../../database/schemas/chef-favourite.schema';
import {
  ChefImpactDaily,
  ChefImpactDailySchema,
} from '../../database/schemas/chef-impact-daily.schema';
import {
  ChefCommunityDaily,
  ChefCommunityDailySchema,
} from '../../database/schemas/chef-community-daily.schema';
import {
  ChefLeaderboardSnapshot,
  ChefLeaderboardSnapshotSchema,
} from '../../database/schemas/chef-leaderboard-snapshot.schema';
import {
  FoodSavedEventLog,
  FoodSavedEventLogSchema,
} from '../../database/schemas/food-saved-event-log.schema';
import { Recipe, RecipeSchema } from '../../database/schemas/recipe.schema';
import { Cuisine, CuisineSchema } from '../../database/schemas/cuisine.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { RedisModule } from '../../redis/redis.module';
import { ImageUploadModule } from '../image-upload/image-upload.module';
import { ChefsController } from './chefs.controller';
import { ChefProfilesController } from './chef-profiles.controller';
import { ChefService } from './chef.service';
import { ChefProfileService } from './chef-profile.service';
import { ChefFavouriteService } from './chef-favourite.service';
import { ChefLookupService } from './chef-lookup.service';
import { ChefProfileSyncService } from './chef-profile-sync.service';
import { ChefImpactListener } from './chef-impact.listener';
import { ChefAnalyticsCronService } from './chef-analytics.cron';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChefProfile.name, schema: ChefProfileSchema },
      { name: ChefFavourite.name, schema: ChefFavouriteSchema },
      { name: ChefImpactDaily.name, schema: ChefImpactDailySchema },
      { name: ChefCommunityDaily.name, schema: ChefCommunityDailySchema },
      {
        name: ChefLeaderboardSnapshot.name,
        schema: ChefLeaderboardSnapshotSchema,
      },
      { name: FoodSavedEventLog.name, schema: FoodSavedEventLogSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: Cuisine.name, schema: CuisineSchema },
      { name: User.name, schema: UserSchema },
    ]),
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 2,
        fields: 30,
      },
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    ImageUploadModule,
  ],
  controllers: [ChefsController, ChefProfilesController],
  providers: [
    ChefService,
    ChefProfileService,
    ChefFavouriteService,
    ChefLookupService,
    ChefProfileSyncService,
    ChefImpactListener,
    ChefAnalyticsCronService,
  ],
  exports: [
    ChefLookupService,
    ChefProfileSyncService,
    ChefProfileService,
    ChefService,
    ChefFavouriteService,
  ],
})
export class ChefModule {}
