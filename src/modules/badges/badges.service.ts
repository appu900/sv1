import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Badge, BadgeDocument, BadgeCategory, MilestoneType } from '../../database/schemas/badge.schema';
import { UserBadge, UserBadgeDocument } from '../../database/schemas/user-badge.schema';
import { UserFoodAnalyticsProfile, UserFoodAnalyticalProfileDocument } from '../../database/schemas/user.food.analyticsProfile.schema';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';
import { OnEvent } from '@nestjs/event-emitter';
import { FoodSavedEvent } from '../analytics/analytics.service';

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    @InjectModel(Badge.name)
    private readonly badgeModel: Model<BadgeDocument>,
    @InjectModel(UserBadge.name)
    private readonly userBadgeModel: Model<UserBadgeDocument>,
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly userAnalyticsModel: Model<UserFoodAnalyticalProfileDocument>,
  ) {}



  async createBadge(dto: CreateBadgeDto): Promise<Badge> {
    const badge = await this.badgeModel.create(dto);
    this.logger.log(`Badge created: ${badge.name} (${badge._id})`);
    return badge;
  }

  async getAllBadges(includeInactive = false): Promise<Badge[]> {
    const filter: any = { isDeleted: false };
    if (!includeInactive) {
      filter.isActive = true;
    }
    return this.badgeModel.find(filter).sort({ rarityScore: -1, createdAt: -1 }).lean();
  }

  async getBadgeStats() {
    const [totalBadges, activeBadges, totalAwarded, uniqueRecipients] = await Promise.all([
      this.badgeModel.countDocuments({ isDeleted: false }),
      this.badgeModel.countDocuments({ isDeleted: false, isActive: true }),
      this.userBadgeModel.countDocuments(),
      this.userBadgeModel.distinct('userId').then(users => users.length),
    ]);

    const badgesByCategory = await this.badgeModel.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const categoryStats = badgesByCategory.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalBadges,
      activeBadges,
      milestoneBadges: categoryStats[BadgeCategory.MILESTONE] || 0,
      challengeBadges: categoryStats[BadgeCategory.CHALLENGE_WINNER] || 0,
      specialBadges: categoryStats[BadgeCategory.SPECIAL] || 0,
      totalAwarded,
      uniqueRecipients,
    };
  }

  async getBadgeById(badgeId: string): Promise<Badge> {
    if (!Types.ObjectId.isValid(badgeId)) {
      throw new BadRequestException('Invalid badge ID');
    }

    const badge = await this.badgeModel.findOne({
      _id: new Types.ObjectId(badgeId),
      isDeleted: false,
    }).lean();

    if (!badge) {
      throw new NotFoundException('Badge not found');
    }

    return badge;
  }

  async updateBadge(badgeId: string, dto: UpdateBadgeDto): Promise<Badge> {
    if (!Types.ObjectId.isValid(badgeId)) {
      throw new BadRequestException('Invalid badge ID');
    }

    const badge = await this.badgeModel.findOneAndUpdate(
      { _id: new Types.ObjectId(badgeId), isDeleted: false },
      { $set: dto },
      { new: true },
    ).lean();

    if (!badge) {
      throw new NotFoundException('Badge not found');
    }

    this.logger.log(`Badge updated: ${badge.name} (${badge._id})`);
    return badge;
  }

  async deleteBadge(badgeId: string): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(badgeId)) {
      throw new BadRequestException('Invalid badge ID');
    }

    const result = await this.badgeModel.findOneAndUpdate(
      { _id: new Types.ObjectId(badgeId) },
      { $set: { isDeleted: true, isActive: false } },
      { new: true },
    );

    if (!result) {
      throw new NotFoundException('Badge not found');
    }

    this.logger.log(`Badge deleted: ${result.name} (${result._id})`);
    return { message: 'Badge deleted successfully' };
  }



  async awardBadge(dto: AwardBadgeDto): Promise<UserBadge> {
    if (!Types.ObjectId.isValid(dto.userId) || !Types.ObjectId.isValid(dto.badgeId)) {
      throw new BadRequestException('Invalid user or badge ID');
    }

    // Check if badge exists and is active
    const badge = await this.badgeModel.findOne({
      _id: new Types.ObjectId(dto.badgeId),
      isActive: true,
      isDeleted: false,
    });

    if (!badge) {
      throw new NotFoundException('Badge not found or inactive');
    }

    // Check if user already has this badge
    const existingBadge = await this.userBadgeModel.findOne({
      userId: new Types.ObjectId(dto.userId),
      badgeId: new Types.ObjectId(dto.badgeId),
    });

    if (existingBadge) {
      throw new ConflictException('User already has this badge');
    }

    const userBadge = await this.userBadgeModel.create({
      userId: new Types.ObjectId(dto.userId),
      badgeId: new Types.ObjectId(dto.badgeId),
      achievedValue: dto.achievedValue,
      metadata: dto.metadata,
    });

    this.logger.log(
      `Badge awarded: ${badge.name} to user ${dto.userId}`,
    );

    return userBadge;
  }

  async awardBadgeToMultipleUsers(
    userIds: string[],
    badgeId: string,
    metadata?: any,
  ): Promise<{ awarded: number; skipped: number }> {
    let awarded = 0;
    let skipped = 0;

    for (const userId of userIds) {
      try {
        await this.awardBadge({
          userId,
          badgeId,
          metadata,
        });
        awarded++;
      } catch (error) {
        if (error instanceof ConflictException) {
          skipped++;
        } else {
          this.logger.error(`Failed to award badge to user ${userId}:`, error);
          skipped++;
        }
      }
    }

    this.logger.log(
      `Bulk badge award completed: ${awarded} awarded, ${skipped} skipped`,
    );

    return { awarded, skipped };
  }



  async getUserBadges(userId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userBadges = await this.userBadgeModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('badgeId')
      .sort({ earnedAt: -1 })
      .lean();

    return userBadges;
  }

  async getUserBadgeStats(userId: string): Promise<{
    totalBadges: number;
    badgesByCategory: Record<string, number>;
    recentBadges: any[];
    unviewedCount: number;
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userBadges = await this.userBadgeModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('badgeId')
      .lean();

    const badgesByCategory: Record<string, number> = {};
    userBadges.forEach((ub: any) => {
      const category = ub.badgeId?.category || 'UNKNOWN';
      badgesByCategory[category] = (badgesByCategory[category] || 0) + 1;
    });

    const recentBadges = userBadges.slice(0, 5);
    const unviewedCount = userBadges.filter(ub => !ub.isViewed).length;

    return {
      totalBadges: userBadges.length,
      badgesByCategory,
      recentBadges,
      unviewedCount,
    };
  }

  async markBadgeAsViewed(userId: string, badgeId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(badgeId)) {
      throw new BadRequestException('Invalid user or badge ID');
    }

    await this.userBadgeModel.updateOne(
      {
        userId: new Types.ObjectId(userId),
        badgeId: new Types.ObjectId(badgeId),
      },
      { $set: { isViewed: true } },
    );
  }


  async checkAndAwardMilestoneBadges(userId: string): Promise<UserBadge[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const analytics = await this.userAnalyticsModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    if (!analytics) {
      return [];
    }

    const milestoneBadges = await this.badgeModel.find({
      category: BadgeCategory.MILESTONE,
      isActive: true,
      isDeleted: false,
    });

    const newBadges: UserBadge[] = [];

    for (const badge of milestoneBadges) {
      // Skip if user already has this badge
      const hasbadge = await this.userBadgeModel.findOne({
        userId: new Types.ObjectId(userId),
        badgeId: badge._id,
      });

      if (hasbadge) continue;

      let shouldAward = false;
      let achievedValue = 0;

      switch (badge.milestoneType) {
        case MilestoneType.TOTAL_MEALS_COOKED:
          achievedValue = analytics.numberOfMealsCooked;
          shouldAward = achievedValue >= (badge.milestoneThreshold || 0);
          break;

        case MilestoneType.TOTAL_FOOD_SAVED:
          achievedValue = analytics.foodSavedInGrams;
          shouldAward = achievedValue >= (badge.milestoneThreshold || 0);
          break;

        // Add more milestone types as needed
      }

      if (shouldAward) {
        try {
          const userBadge = await this.awardBadge({
            userId: userId.toString(),
            badgeId: badge._id.toString(),
            achievedValue,
          });
          newBadges.push(userBadge);
        } catch (error) {
          this.logger.error(
            `Failed to award milestone badge ${badge.name} to user ${userId}:`,
            error,
          );
        }
      }
    }

    return newBadges;
  }


  async awardChallengeWinnerBadge(
    challengeId: string,
    challengeName: string,
    winnerId: string,
    rank: number,
    totalParticipants: number,
    achievedValue: number,
  ): Promise<UserBadge | null> {
    if (!Types.ObjectId.isValid(winnerId) || !Types.ObjectId.isValid(challengeId)) {
      throw new BadRequestException('Invalid challenge or user ID');
    }

    // Find or create challenge winner badge
    let badge = await this.badgeModel.findOne({
      category: BadgeCategory.CHALLENGE_WINNER,
      challengeId: challengeId,
      isActive: true,
      isDeleted: false,
    });

    if (!badge) {
      // Create a generic challenge winner badge
      badge = await this.badgeModel.create({
        name: `${challengeName} Winner`,
        description: `Winner of the ${challengeName} challenge`,
        imageUrl: '/badges/challenge-winner-default.png',
        category: BadgeCategory.CHALLENGE_WINNER,
        challengeId: challengeId,
        rarityScore: 100,
        isActive: true,
      });
    }

    try {
      const userBadge = await this.awardBadge({
        userId: winnerId.toString(),
        badgeId: badge._id.toString(),
        achievedValue,
        metadata: {
          challengeId,
          challengeName,
          rank,
          totalParticipants,
        },
      });

      return userBadge;
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn(
          `User ${winnerId} already has badge for challenge ${challengeId}`,
        );
        return null;
      }
      throw error;
    }
  }


  async getBadgeLeaderboard(limit = 10): Promise<any[]> {
    const leaderboard = await this.userBadgeModel.aggregate([
      {
        $group: {
          _id: '$userId',
          badgeCount: { $sum: 1 },
          badges: { $push: '$badgeId' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: '$user',
      },
      {
        $sort: { badgeCount: -1 },
      },
      {
        $limit: limit,
      },
      {
        $project: {
          userId: '$_id',
          userName: '$user.name',
          userEmail: '$user.email',
          badgeCount: 1,
        },
      },
    ]);

    return leaderboard;
  }


  @OnEvent('food.saved')
  async handleFoodSavedEvent(event: FoodSavedEvent) {
    try {
      await this.checkAndAwardMilestoneBadges(event.userId);
    } catch (error) {
      this.logger.error(
        `Failed to check badges for user ${event.userId} after food saved:`,
        error,
      );
    }
  }
}
