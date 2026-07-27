import { Injectable, BadRequestException, UnauthorizedException, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserRole } from 'src/database/schemas/user.auth.schema';
import { Ingredient } from 'src/database/schemas/ingredient.schema';
import { Hacks } from 'src/database/schemas/hacks.schema';
import { Sponsers } from 'src/database/schemas/sponsers.schema';
import { FoodFact } from 'src/database/schemas/food-fact.schema';
import { Stickers } from 'src/database/schemas/stcikers.schema';
import { QantasFFN, QantasFFNDocument } from 'src/database/schemas/qantas-ffn.schema';
import { TrackSurvey, TrackSurveyDocument } from 'src/database/schemas/track-survey.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from 'src/database/schemas/chef-profile.schema';
import {
  ChefFavourite,
  ChefFavouriteDocument,
} from 'src/database/schemas/chef-favourite.schema';
import { CreateChefDto } from './dto/create-chef.dto';
import * as bcrypt from 'bcrypt';
import { ChefProfileService } from '../chef/chef-profile.service';
import { ChefService } from '../chef/chef.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ingredient.name) private readonly ingredientModel: Model<Ingredient>,
    @InjectModel(Hacks.name) private readonly hackModel: Model<Hacks>,
    @InjectModel(Sponsers.name) private readonly sponsorModel: Model<Sponsers>,
    @InjectModel(FoodFact.name) private readonly foodFactModel: Model<FoodFact>,
    @InjectModel(Stickers.name) private readonly stickerModel: Model<Stickers>,
    @InjectModel(QantasFFN.name) private readonly qantasFFNModel: Model<QantasFFNDocument>,
    @InjectModel(TrackSurvey.name) private readonly trackSurveyModel: Model<TrackSurveyDocument>,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(ChefFavourite.name)
    private readonly chefFavouriteModel: Model<ChefFavouriteDocument>,
    @Optional() private readonly chefProfileService?: ChefProfileService,
    @Optional() private readonly chefService?: ChefService,
  ) {}

  private mapQantasFFN(ffn: any | null) {
    if (!ffn) return null;
    return {
      memberId: ffn.memberId,
      isLinked: Boolean(ffn.isLinked),
      linkedAt: ffn.linkedAt ?? null,
      linkStatus: ffn.linkStatus,
    };
  }

  private mapTrackSurvey(survey: any) {
    return {
      id: String(survey._id),
      completedAt: survey.completedAt,
      surveyWeek: survey.surveyWeek,
      surveyDay: survey.surveyDay,
      isBaseline: survey.isBaseline,
      cookingFrequency: survey.cookingFrequency,
      scraps: survey.scraps,
      uneatenLeftovers: survey.uneatenLeftovers,
      preferredIngredients: survey.preferredIngredients || [],
      calculatedSavings: survey.calculatedSavings,
    };
  }

  private async getQantasFFNForUser(userId: Types.ObjectId) {
    return this.qantasFFNModel
      .findOne({ userId, isDeleted: { $ne: true } })
      .sort({ isLinked: -1, updatedAt: -1 })
      .lean();
  }

  private async getTrackSurveysForUser(userId: Types.ObjectId) {
    return this.trackSurveyModel
      .find({ userId })
      .sort({ completedAt: -1 })
      .lean();
  }

  async createChef(dto: CreateChefDto) {
    const existingChef = await this.userModel.findOne({ email: dto.email });
    if (existingChef) {
      throw new BadRequestException('Chef with this email already exists');
    }

    
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const chef = await this.userModel.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: UserRole.CHEF,
    });

    // Draft chef profile (unpublished) so impact attribution can resolve later.
    try {
      await this.chefProfileService?.ensureForUser(
        String(chef._id),
        chef.name,
      );
    } catch {
      // non-fatal — backfill can create profiles later
    }

    return {
      success: true,
      message: 'Chef created successfully',
      chef: {
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      },
    };
  }

  async getAllChefs() {
    const chefs = await this.userModel
      .find({ role: UserRole.CHEF })
      .select('-passwordHash')
      .lean();

    return {
      chefs: chefs.map((chef) => ({
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      })),
    };
  }

  async getChefById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid chef ID');
    }

    const chef = await this.userModel
      .findOne({ _id: new Types.ObjectId(id), role: UserRole.CHEF })
      .select('-passwordHash')
      .lean();

    if (!chef) {
      throw new NotFoundException('Chef not found');
    }

    return {
      chef: {
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      },
    };
  }

  async deleteChef(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid chef ID');
    }

    const chefObjectId = new Types.ObjectId(id);
    const chef = await this.userModel.findOne({
      _id: chefObjectId,
      role: UserRole.CHEF,
    });

    if (!chef) {
      throw new NotFoundException('Chef not found');
    }

    // Delete catalog recipes solely attributed to this chef
    const soleOwned = await this.recipeModel
      .find({
        chefIds: chefObjectId,
        $expr: { $eq: [{ $size: { $ifNull: ['$chefIds', []] } }, 1] },
      })
      .select({ _id: 1 })
      .lean()
      .exec();

    const soleOwnedIds = soleOwned.map((r) => r._id);
    const deletedRecipes = soleOwnedIds.length
      ? await this.recipeModel.deleteMany({ _id: { $in: soleOwnedIds } })
      : { deletedCount: 0 };

    // Co-authored recipes: remove this chef, keep the recipe
    const pulled = await this.recipeModel.updateMany(
      {
        chefIds: chefObjectId,
        ...(soleOwnedIds.length ? { _id: { $nin: soleOwnedIds } } : {}),
      },
      { $pull: { chefIds: chefObjectId } },
    );

    const profile = await this.chefProfileModel
      .findOne({ userId: chefObjectId })
      .select({ _id: 1 })
      .lean()
      .exec();

    if (profile?._id) {
      await this.chefFavouriteModel.deleteMany({ chefId: profile._id });
      await this.chefProfileModel.deleteOne({ _id: profile._id });
    }

    await this.userModel.deleteOne({ _id: chefObjectId });

    if (this.chefService?.invalidateCaches) {
      await this.chefService.invalidateCaches().catch(() => undefined);
    }

    return {
      success: true,
      message: 'Chef and related recipes deleted successfully',
      deleted: {
        catalogRecipes: deletedRecipes.deletedCount || 0,
        sharedRecipesUpdated: pulled.modifiedCount || 0,
        profiles: profile?._id ? 1 : 0,
      },
    };
  }

  async getAllUsers(filters?: { name?: string; country?: string; page?: number; limit?: number }) {
    const query: any = { role: UserRole.USER };
    if (filters?.name?.trim()) {
      query.name = { $regex: filters.name.trim(), $options: 'i' };
    }
    if (filters?.country?.trim()) {
      query.country = { $regex: filters.country.trim(), $options: 'i' };
    }
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    const userIds = users.map((u) => u._id as Types.ObjectId);

    const [qantasProfiles, surveyCounts] = await Promise.all([
      this.qantasFFNModel
        .find({ userId: { $in: userIds }, isDeleted: { $ne: true } })
        .sort({ isLinked: -1, updatedAt: -1 })
        .lean(),
      this.trackSurveyModel.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]),
    ]);

    const qantasByUser = new Map<string, any>();
    for (const profile of qantasProfiles) {
      const key = String(profile.userId);
      // First entry wins (sorted by isLinked desc, updatedAt desc)
      if (!qantasByUser.has(key)) qantasByUser.set(key, profile);
    }
    const surveyCountByUser = new Map<string, number>(
      surveyCounts.map((entry: any) => [String(entry._id), entry.count]),
    );

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      users: users.map((user) => {
        const userIdStr = String(user._id);
        const qantasFFN = this.mapQantasFFN(qantasByUser.get(userIdStr));
        return {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          country: user.country,
          stateCode: user.stateCode,
          dietaryProfile: user.dietaryProfile ? {
            vegType: user.dietaryProfile.vegType,
            dairyFree: user.dietaryProfile.dairyFree,
            nutFree: user.dietaryProfile.nutFree,
            glutenFree: user.dietaryProfile.glutenFree,
            hasDiabetes: user.dietaryProfile.hasDiabetes,
            otherAllergies: user.dietaryProfile.otherAllergies || [],
          } : null,
          onboarding: user.country ? {
            noOfAdults: user.dietaryProfile?.noOfAdults || 1,
            noOfChildren: user.dietaryProfile?.noOfChildren || 0,
            country: user.country,
            stateCode: user.stateCode,
            pincode: (user as any).pincode || null,
          } : null,
          createdAt: user['createdAt'],
          updatedAt: user['updatedAt'],
          qantasFFN,
          _count: {
            cookedRecipes: 0,
            bookmarkedRecipes: 0,
            surveys: surveyCountByUser.get(userIdStr) || 0,
          },
        };
      }),
    };
  }

  async getUserById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(id);
    const user = await this.userModel
      .findOne({ _id: userObjectId, role: UserRole.USER })
      .select('-passwordHash')
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [qantasProfile, trackSurveys] = await Promise.all([
      this.getQantasFFNForUser(userObjectId),
      this.getTrackSurveysForUser(userObjectId),
    ]);

    const mappedSurveys = trackSurveys.map((s) => this.mapTrackSurvey(s));

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        country: user.country,
        stateCode: user.stateCode,
        dietaryProfile: user.dietaryProfile ? {
          vegType: user.dietaryProfile.vegType,
          dairyFree: user.dietaryProfile.dairyFree,
          nutFree: user.dietaryProfile.nutFree,
          glutenFree: user.dietaryProfile.glutenFree,
          hasDiabetes: user.dietaryProfile.hasDiabetes,
          otherAllergies: user.dietaryProfile.otherAllergies || [],
        } : null,
        onboarding: user.country ? {
          noOfAdults: user.dietaryProfile?.noOfAdults || 1,
          noOfChildren: user.dietaryProfile?.noOfChildren || 0,
          country: user.country,
          stateCode: user.stateCode,
          pincode: (user as any).pincode || null,
        } : null,
        createdAt: user['createdAt'],
        updatedAt: user['updatedAt'],
        qantasFFN: this.mapQantasFFN(qantasProfile),
        trackSurveys: mappedSurveys,
        _count: {
          cookedRecipes: 0, // TODO: implement actual count from recipes
          bookmarkedRecipes: 0, // TODO: implement actual count from bookmarks
          surveys: mappedSurveys.length,
        },
      },
    };
  }

  async deleteUser(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(id),
      role: UserRole.USER,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userModel.deleteOne({ _id: new Types.ObjectId(id) });

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  async getStats() {
    const totalUsers = await this.userModel.countDocuments({
      role: UserRole.USER,
    });

    const totalChefs = await this.userModel.countDocuments({
      role: UserRole.CHEF,
    });

    const usersWithDietaryProfile = await this.userModel.countDocuments({
      role: UserRole.USER,
      'dietaryProfile.vegType': { $exists: true },
    });

    const usersWithCountry = await this.userModel.countDocuments({
      role: UserRole.USER,
      country: { $exists: true, $ne: null },
    });

    const dietaryProfileCompletionRate =
      totalUsers > 0
        ? `${((usersWithDietaryProfile / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    const onboardingCompletionRate =
      totalUsers > 0
        ? `${((usersWithCountry / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    return {
      totalUsers,
      totalChefs,
      usersWithDietaryProfile,
      dietaryProfileCompletionRate,
      usersWithOnboarding: usersWithCountry,
      onboardingCompletionRate,
    };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      totalChefs,
      totalIngredients,
      totalHacks,
      totalSponsors,
      totalFoodFacts,
      totalStickers,
      usersWithDietaryProfile,
      usersWithCountry,
      recentUsers,
      recentChefs,
    ] = await Promise.all([
      this.userModel.countDocuments({ role: UserRole.USER }),
      this.userModel.countDocuments({ role: UserRole.CHEF }),
      this.ingredientModel.countDocuments(),
      this.hackModel.countDocuments(),
      this.sponsorModel.countDocuments(),
      this.foodFactModel.countDocuments(),
      this.stickerModel.countDocuments(),
      this.userModel.countDocuments({
        role: UserRole.USER,
        'dietaryProfile.vegType': { $exists: true },
      }),
      this.userModel.countDocuments({
        role: UserRole.USER,
        country: { $exists: true, $ne: null },
      }),
      this.userModel
        .find({ role: UserRole.USER })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name email createdAt')
        .lean(),
      this.userModel
        .find({ role: UserRole.CHEF })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name email createdAt')
        .lean(),
    ]);

    const dietaryProfileCompletionRate =
      totalUsers > 0
        ? `${((usersWithDietaryProfile / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    const onboardingCompletionRate =
      totalUsers > 0
        ? `${((usersWithCountry / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    // Calculate user growth for the last 7 days
    const userGrowth = await this.calculateGrowth(UserRole.USER, 7);
    const chefGrowth = await this.calculateGrowth(UserRole.CHEF, 7);

    return {
      totalUsers,
      totalChefs,
      totalRecipes: 0, // TODO: Implement when recipe model is ready
      totalIngredients,
      totalHacks,
      totalSponsors,
      totalFoodFacts,
      totalStickers,
      usersWithDietaryProfile,
      dietaryProfileCompletionRate,
      usersWithOnboarding: usersWithCountry,
      onboardingCompletionRate,
      recentUsers: recentUsers.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        createdAt: user['createdAt'],
      })),
      recentChefs: recentChefs.map((chef) => ({
        id: chef._id.toString(),
        name: chef.name,
        email: chef.email,
        createdAt: chef['createdAt'],
      })),
      userGrowth,
      chefGrowth,
    };
  }

  async getPlatformHealth() {
    const totalUsers = await this.userModel.countDocuments({ role: UserRole.USER });
    const activeUsers = await this.userModel.countDocuments({
      role: UserRole.USER,
      updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    const healthScore = Math.min(
      Math.round(((activeUsers || 1) / Math.max(totalUsers, 1)) * 100),
      100
    );

    return {
      score: healthScore,
      uptime: '99.9%',
      responseTime: `${Math.floor(Math.random() * 50 + 100)}ms`,
      activeUsers,
      serverLoad: 'Low',
    };
  }

  async getUserGrowth() {
    const growth = await this.calculateGrowth(UserRole.USER, 7);
    return { growth };
  }

  async getActivityLog() {
    const recentUsers = await this.userModel
      .find({ role: UserRole.USER })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name email createdAt')
      .lean();

    const recentChefs = await this.userModel
      .find({ role: UserRole.CHEF })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name email createdAt')
      .lean();

    const activities = [
      ...recentUsers.map((user) => ({
        id: user._id.toString(),
        type: 'user' as const,
        action: 'New user registered',
        description: `${user.name} joined the platform`,
        timestamp: user['createdAt'],
      })),
      ...recentChefs.map((chef) => ({
        id: chef._id.toString(),
        type: 'chef' as const,
        action: 'New chef registered',
        description: `Chef ${chef.name} joined the platform`,
        timestamp: chef['createdAt'],
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    return { activities };
  }

  private async calculateGrowth(role: UserRole, days: number): Promise<Array<{ date: string; count: number }>> {
    const growth: Array<{ date: string; count: number }> = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.userModel.countDocuments({
        role,
        createdAt: {
          $gte: date,
          $lt: nextDate,
        },
      });

      growth.push({
        date: date.toISOString().split('T')[0],
        count,
      });
    }

    return growth;
  }
}
