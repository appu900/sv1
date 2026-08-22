import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './modules/user/user.module';
import { HackModule } from './modules/hack/hack.module';
import { ImageUploadModule } from './modules/image-upload/image-upload.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { StickerModule } from './modules/sticker/sticker.module';
import { SponsersModule } from './modules/sponsers/sponsers.module';
import { AdminModule } from './modules/admin/admin.module';
import { HackOrTipModule } from './modules/hack-or-tip/hack-or-tip.module';
import { CommunityGroupsModule } from './modules/community-groups/community-groups.module';
import { DietModule } from './modules/diet/diet.module';
import { FoodFactModule } from './modules/food-fact/food-fact.module';
import { RecipeModule } from './modules/recipe/recipe.module';
import { FrameworkCategoryModule } from './modules/framework-category/framework-category.module';
import { CuisineModule } from './modules/cuisine/cuisine.module';
import { ChefModule } from './modules/chef/chef.module';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { FavouriteModule } from './modules/favourite/favourite.module';
import { BadgesModule } from './modules/badges/badges.module';
import { ShoppingListModule } from './modules/shopping-list/shopping-list.module';
import { TrackSurveyModule } from './modules/track-survey/track-survey.module';
import { SurveyConfigModule } from './modules/survey-config/survey-config.module';
import { PromoModule } from './modules/promo/promo.module';
import { QantasModule } from './modules/qantas/qantas.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import {EventEmitterModule} from "@nestjs/event-emitter"
import { WinstonModule, WINSTON_MODULE_PROVIDER } from 'nest-winston';
import createWinstonLogger from './logger';
import { SqsModule } from './sqs/sqs.module';
import { NotificationModule } from './modules/notification/notification.module';
import { CookbookaiModule } from './modules/cookbookai/cookbookai.module';
import { SharedRecipeModule } from './modules/shared-recipe/shared-recipe.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { MealPlanModule } from './modules/meal-plan/meal-plan.module';
import { UserEventsModule } from './modules/user-events/user-events.module';
import { AIInteractionModule } from './modules/ai-interaction/ai-interaction.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { DeeplinkModule } from './modules/deeplink/deeplink.module';
import { PerksModule } from './modules/perks/perks.module';
import { DataVersionModule } from './modules/data-version/data-version.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot({
      instance: createWinstonLogger(),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          const url = new URL(redisUrl.replace(/^redis:\/\//, 'rediss://'));
          return {
            prefix: '{bull}',
            connection: {
              host: url.hostname,
              port: Number(url.port) || 6379,
              username: url.username || config.get('REDIS_USERNAME'),
              password: url.password || config.get('REDIS_PASSWORD'),
              tls: {},
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
            },
          };
        }
        return {
          prefix: '{bull}',
          connection: {
            host: config.get('REDIS_HOST', '127.0.0.1'),
            port: config.get<number>('REDIS_PORT', 6379),
            db: config.get<number>('REDIS_DB', 0),
            username: config.get('REDIS_USERNAME'),
            password: config.get('REDIS_PASSWORD'),
            tls: {},
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
    RedisModule,
    DataVersionModule,
    UserModule,
    HackModule,
    ImageUploadModule,
    IngredientsModule,
    DietModule,
    StickerModule,
    SponsersModule,
    AdminModule,
    HackOrTipModule,
    CommunityGroupsModule,
    FoodFactModule,
    RecipeModule,
    FrameworkCategoryModule,
    CuisineModule,
    ChefModule,
    AnalyticsModule,
    FeedbackModule,
    FavouriteModule,
    BadgesModule,
    ShoppingListModule,
    TrackSurveyModule,
    SurveyConfigModule,
    PromoModule,
    QantasModule,
    InventoryModule,
    SqsModule,
    NotificationModule,
    CookbookaiModule,
    SharedRecipeModule,
    NutritionModule,
    MealPlanModule,
    UserEventsModule,
    AIInteractionModule,
    SubscriptionModule,
    DeeplinkModule,
    PerksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}



