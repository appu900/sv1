import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserFoodAnalyticalProfileDocument,
  UserFoodAnalyticsProfile,
} from 'src/database/schemas/user.food.analyticsProfile.schema';
import {
  CommunityGroups,
  CommunityGroupDocument,
} from 'src/database/schemas/community.groups.schema';
import {
  CommunityGroupMember,
  CommunityGroupMemberDocument,
} from 'src/database/schemas/CommunityGroupMember.schema';
import {
  CommunityChallenge,
  CommunityChallengeDocument,
} from 'src/database/schemas/challenge.schema';
import {
  CommunityChallengeParticipant,
  CommunityChallengeParticipantDocument,
} from 'src/database/schemas/challenge.members.schema';
import { FoodSavedEvent } from './analytics.service';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from 'src/redis/redis.service';
import { UserEventService } from '../user-events/user-event.service';
import { RecipeViewService } from '../user-events/recipe-view.service';
import { UserEventType } from 'src/database/schemas/user-event.schema';
import { MetricsService } from './metrics.service';

@Injectable()
export class AnalyticsListner {
  private readonly logger = new Logger(AnalyticsListner.name);
  constructor(
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly profileModel: Model<UserFoodAnalyticalProfileDocument>,
    @InjectModel(CommunityGroups.name)
    private readonly communityGroupModel: Model<CommunityGroupDocument>,
    @InjectModel(CommunityGroupMember.name)
    private readonly communityGroupMemberModel: Model<CommunityGroupMemberDocument>,
    @InjectModel(CommunityChallenge.name)
    private readonly communityChallengeModel: Model<CommunityChallengeDocument>,
    @InjectModel(CommunityChallengeParticipant.name)
    private readonly challengeParticipantModel: Model<CommunityChallengeParticipantDocument>,
    private readonly redisService: RedisService,
    private readonly userEventService: UserEventService,
    private readonly recipeViewService: RecipeViewService,
    private readonly metricsService: MetricsService,
  ) {}

  @OnEvent('food.saved', { async: true })
  async updateUserProfile(event: FoodSavedEvent) {
    // Persist per-event log. The unique partial index on
    // (userId, idempotencyKey) makes concurrent duplicate writes a
    // key-violation that `logFoodSaved` silently swallows, so a
    // retried `food.saved` event can't double-write the log.
    void this.metricsService.logFoodSaved({
      userId: event.userId,
      frameworkId: event.frameworkId ?? null,
      ingredientIds: event.ingredinatIds ?? [],
      foodSavedInGrams: event.foodSavedInGrams,
      moneySaved: event.totalPriceInLocalCurrency ?? 0,
      co2SavedInGrams: event.totalCo2SavedInGrams ?? 0,
      country: event.country ?? null,
      idempotencyKey: event.idempotencyKey ?? null,
    });

    void this.userEventService.recordFirst(
      event.userId,
      UserEventType.FIRST_RECIPE_COOKED,
      { frameworkId: event.frameworkId },
    );
    void this.recipeViewService.incrementCookCount(event.frameworkId);

    try {
      const updateOperation: any = {
        $inc: {
          foodSavedInGrams: event.foodSavedInGrams,
          numberOfMealsCooked: 1,
          totalMoneySaved: event.totalPriceInLocalCurrency || 0,
          totalCo2SavedInGrams: event.totalCo2SavedInGrams || 0,
        },
      };

      if (event.frameworkId) {
        updateOperation.$addToSet = {
          cookedRecipes: event.frameworkId,
        };
      }

      await this.profileModel.findOneAndUpdate(
        { userId: new Types.ObjectId(event.userId) },
        updateOperation,
        { upsert: true, new: true },
      );

      await Promise.all([
        this.updateCommunityGroups(event),
        this.updateChallenges(event),
        this.invalidateAggregateCaches(),
      ]);
    } catch (error: any) {
      this.logger.error(
        `Failed to update profile: ${error.message}`,
        error.stack,
      );
    }
  }

  private async invalidateAggregateCaches(): Promise<void> {
    try {
      await Promise.all([
        this.redisService.delByPattern('analytics:leaderboard:v2:*'),
        this.redisService.delByPattern('analytics:trending:v2:*'),
      ]);
    } catch (err: any) {
      this.logger.warn(`aggregate cache invalidation failed: ${err?.message}`);
    }
  }

  private async updateCommunityGroups(event: FoodSavedEvent) {
    try {
      const userMemberships = await this.communityGroupMemberModel
        .find({
          userId: new Types.ObjectId(event.userId),
          isActive: true,
        })
        .select('groupId')
        .lean();

      if (userMemberships.length === 0) return;
      const groupIds = userMemberships.map((m) => m.groupId);

      await this.communityGroupModel.updateMany(
        { _id: { $in: groupIds }, isDeleted: false },
        { $inc: { totalFoodSaved: event.foodSavedInGrams } },
      );

      await Promise.all(
        groupIds.map((groupId) =>
          this.redisService.del(`community:group:${groupId.toString()}`),
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to update community groups: ${error.message}`,
        error.stack,
      );
    }
  }

  private async updateChallenges(event: FoodSavedEvent) {
    try {
      const now = new Date();
      const userOid = new Types.ObjectId(event.userId);

      const userGroups = await this.communityGroupMemberModel
        .find({ userId: userOid, isActive: true })
        .select('groupId')
        .lean();
      if (userGroups.length === 0) return;
      const groupIds = userGroups.map((g) => g.groupId);

      const activeChallenges = await this.communityChallengeModel
        .find({
          communityId: { $in: groupIds },
          isDeleted: false,
          status: true,
          startDate: { $lte: now },
          endDate: { $gte: now },
        })
        .select('_id communityId')
        .lean();
      if (activeChallenges.length === 0) return;

      const activeChallengeIds = activeChallenges.map((ch: any) => ch._id);

      await this.communityChallengeModel.updateMany(
        { _id: { $in: activeChallengeIds } },
        {
          $inc: {
            totalFoodSaved: event.foodSavedInGrams,
            totalMealsCompleted: 1,
          },
        },
      );

      const bulkOps = activeChallenges.map((challenge: any) => ({
        updateOne: {
          filter: {
            userId: userOid,
            challengeId: challenge._id,
            communityId: challenge.communityId,
            isActive: true,
          },
          update: {
            $inc: {
              foodSaved: event.foodSavedInGrams,
              totalMealsCompleted: 1,
            },
          },
          upsert: true,
        },
      }));
      if (bulkOps.length) {
        await this.challengeParticipantModel.bulkWrite(bulkOps, {
          ordered: false,
        });
      }

      const invalidations: Promise<any>[] = [];
      for (const challenge of activeChallenges as any[]) {
        invalidations.push(
          this.redisService.del(
            `community:challenge:single:${challenge._id.toString()}`,
          ),
          this.redisService.del(
            `community:challenges:communityId:${challenge.communityId.toString()}`,
          ),
        );
      }
      await Promise.all(invalidations);
    } catch (error: any) {
      this.logger.error(
        `Failed to update challenges: ${error.message}`,
        error.stack,
      );
    }
  }
}
