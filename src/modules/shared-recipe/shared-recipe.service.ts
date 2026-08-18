import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SharedRecipe,
  SharedRecipeDocument,
  ShareType,
} from 'src/database/schemas/shared-recipe.schema';
import {
  SharedRecipeLike,
  SharedRecipeLikeDocument,
} from 'src/database/schemas/shared-recipe-like.schema';
import { userRecipe, UserRecipeDocument } from 'src/database/schemas/user.schema';
import {
  CommunityGroupMember,
  CommunityGroupMemberDocument,
} from 'src/database/schemas/CommunityGroupMember.schema';
import {
  CommunityGroups,
  CommunityGroupDocument,
} from 'src/database/schemas/community.groups.schema';
import { NotificationService } from '../notification/notification.service';
import { ShareRecipeDto } from './dto/share-recipe.dto';

@Injectable()
export class SharedRecipeService {
  private readonly logger = new Logger(SharedRecipeService.name);

  constructor(
    @InjectModel(SharedRecipe.name)
    private readonly sharedRecipeModel: Model<SharedRecipeDocument>,
    @InjectModel(SharedRecipeLike.name)
    private readonly sharedRecipeLikeModel: Model<SharedRecipeLikeDocument>,
    @InjectModel(userRecipe.name)
    private readonly userRecipeModel: Model<UserRecipeDocument>,
    @InjectModel(CommunityGroupMember.name)
    private readonly communityMemberModel: Model<CommunityGroupMemberDocument>,
    @InjectModel(CommunityGroups.name)
    private readonly communityGroupModel: Model<CommunityGroupDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Build a match filter that handles userid stored as both string and ObjectId.
   */
  private buildUserMatch(userId: string) {
    const normalized = String(userId || '').trim();
    if (!normalized) return { userid: '__invalid_user__' };
    const orConditions: any[] = [{ userid: normalized }];
    if (Types.ObjectId.isValid(normalized)) {
      orConditions.push({ userid: new Types.ObjectId(normalized) });
    }
    return { $or: orConditions };
  }

  async shareRecipe(userId: string, dto: ShareRecipeDto) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const recipe = await this.userRecipeModel.findOne({
      _id: new Types.ObjectId(dto.recipeId),
      ...this.buildUserMatch(userId),
      status: 'accepted',
    });

    if (!recipe) {
      throw new NotFoundException(
        'Recipe not found or is still being generated',
      );
    }

    if (dto.shareType === 'community') {
      if (!dto.communityId) {
        throw new BadRequestException(
          'communityId is required for community shares',
        );
      }

      const group = await this.communityGroupModel.findOne({
        _id: new Types.ObjectId(dto.communityId),
        isDeleted: false,
      });
      if (!group) {
        throw new NotFoundException('Community not found');
      }

      const membership = await this.communityMemberModel.findOne({
        groupId: new Types.ObjectId(dto.communityId),
        userId: new Types.ObjectId(userId),
        isActive: true,
      });
      if (!membership) {
        throw new ForbiddenException(
          'You must be a member of this community to share recipes',
        );
      }
    }

    const existingFilter: any = {
      sharedBy: new Types.ObjectId(userId),
      recipeId: new Types.ObjectId(dto.recipeId),
      shareType: dto.shareType,
      isActive: true,
    };
    if (dto.shareType === 'community') {
      existingFilter.communityId = new Types.ObjectId(dto.communityId);
    }
    const existing = await this.sharedRecipeModel.findOne(existingFilter);
    if (existing) {
      throw new ConflictException(
        dto.shareType === 'community'
          ? 'Recipe already shared to this community'
          : 'Recipe is already shared publicly',
      );
    }

    const sharedRecipe = await this.sharedRecipeModel.create({
      recipeId: new Types.ObjectId(dto.recipeId),
      sharedBy: new Types.ObjectId(userId),
      shareType: dto.shareType,
      communityId: dto.communityId
        ? new Types.ObjectId(dto.communityId)
        : undefined,
      message: dto.message || '',
    });

    if (dto.shareType === 'community' && dto.communityId) {
      this.notifyCommunityMembers(
        userId,
        dto.communityId,
        recipe.title,
        String(sharedRecipe._id),
      ).catch((err) =>
        this.logger.warn(
          `Failed to notify community members: ${err?.message}`,
        ),
      );
    }

    return {
      success: true,
      message:
        dto.shareType === 'community'
          ? 'Recipe shared to community!'
          : 'Recipe shared publicly!',
      data: sharedRecipe,
    };
  }

  async unshareRecipe(userId: string, sharedRecipeId: string) {
    const sharedRecipe = await this.sharedRecipeModel.findOne({
      _id: new Types.ObjectId(sharedRecipeId),
      sharedBy: new Types.ObjectId(userId),
      isActive: true,
    });

    if (!sharedRecipe) {
      throw new NotFoundException('Shared recipe not found');
    }

    sharedRecipe.isActive = false;
    await sharedRecipe.save();

    return { success: true, message: 'Recipe unshared successfully' };
  }

  async getCommunityRecipes(
    userId: string,
    communityId: string,
    page = 1,
    limit = 20,
  ) {
    if (!Types.ObjectId.isValid(communityId)) {
      throw new BadRequestException('Invalid community ID');
    }

    const membership = await this.communityMemberModel.findOne({
      groupId: new Types.ObjectId(communityId),
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
    if (!membership) {
      throw new ForbiddenException('You must be a member of this community');
    }

    const skip = (page - 1) * limit;

    const [recipes, total] = await Promise.all([
      this.sharedRecipeModel
        .find({
          communityId: new Types.ObjectId(communityId),
          shareType: ShareType.COMMUNITY,
          isActive: true,
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'recipeId',
          select:
            'title shortDescription heroImageUrl portions prepCookTime components',
        })
        .populate({ path: 'sharedBy', select: 'name' })
        .lean(),
      this.sharedRecipeModel.countDocuments({
        communityId: new Types.ObjectId(communityId),
        shareType: ShareType.COMMUNITY,
        isActive: true,
      }),
    ]);

    const sharedIds = recipes.map((r: any) => r._id);
    const userLikes = await this.sharedRecipeLikeModel
      .find({
        sharedRecipeId: { $in: sharedIds },
        userId: new Types.ObjectId(userId),
      })
      .select('sharedRecipeId')
      .lean();

    const likedSet = new Set(
      userLikes.map((l: any) => String(l.sharedRecipeId)),
    );

    const enriched = recipes.map((r: any) => ({
      ...r,
      isLikedByMe: likedSet.has(String(r._id)),
    }));

    return {
      success: true,
      data: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPublicRecipes(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [recipes, total] = await Promise.all([
      this.sharedRecipeModel
        .find({ shareType: ShareType.PUBLIC, isActive: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'recipeId',
          select:
            'title shortDescription heroImageUrl portions prepCookTime components',
        })
        .populate({ path: 'sharedBy', select: 'name' })
        .lean(),
      this.sharedRecipeModel.countDocuments({
        shareType: ShareType.PUBLIC,
        isActive: true,
      }),
    ]);

    const sharedIds = recipes.map((r: any) => r._id);
    const userLikes = userId
      ? await this.sharedRecipeLikeModel
          .find({
            sharedRecipeId: { $in: sharedIds },
            userId: new Types.ObjectId(userId),
          })
          .select('sharedRecipeId')
          .lean()
      : [];

    const likedSet = new Set(
      userLikes.map((l: any) => String(l.sharedRecipeId)),
    );

    const enriched = recipes.map((r: any) => ({
      ...r,
      isLikedByMe: likedSet.has(String(r._id)),
    }));

    return {
      success: true,
      data: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }


  async toggleLike(userId: string, sharedRecipeId: string) {
    if (!Types.ObjectId.isValid(sharedRecipeId)) {
      throw new BadRequestException('Invalid shared recipe ID');
    }

    const sharedRecipe = await this.sharedRecipeModel.findOne({
      _id: new Types.ObjectId(sharedRecipeId),
      isActive: true,
    });
    if (!sharedRecipe) {
      throw new NotFoundException('Shared recipe not found');
    }

    const existing = await this.sharedRecipeLikeModel.findOne({
      sharedRecipeId: new Types.ObjectId(sharedRecipeId),
      userId: new Types.ObjectId(userId),
    });

    if (existing) {
      await this.sharedRecipeLikeModel.deleteOne({ _id: existing._id });
      await this.sharedRecipeModel.updateOne(
        { _id: new Types.ObjectId(sharedRecipeId) },
        { $inc: { likesCount: -1 } },
      );
      return { success: true, liked: false, message: 'Unliked' };
    }

    await this.sharedRecipeLikeModel.create({
      sharedRecipeId: new Types.ObjectId(sharedRecipeId),
      userId: new Types.ObjectId(userId),
    });
    await this.sharedRecipeModel.updateOne(
      { _id: new Types.ObjectId(sharedRecipeId) },
      { $inc: { likesCount: 1 } },
    );

    return { success: true, liked: true, message: 'Liked!' };
  }

  async saveToMyCookbook(userId: string, sharedRecipeId: string) {
    const sharedRecipe = await this.sharedRecipeModel
      .findOne({
        _id: new Types.ObjectId(sharedRecipeId),
        isActive: true,
      })
      .populate('recipeId');

    if (!sharedRecipe) {
      throw new NotFoundException('Shared recipe not found');
    }

    const sourceRecipe = sharedRecipe.recipeId as any;
    if (!sourceRecipe) {
      throw new NotFoundException('Source recipe no longer exists');
    }

    // Check if user already has this recipe saved
    const alreadySaved = await this.userRecipeModel.findOne({
      ...this.buildUserMatch(userId),
      title: sourceRecipe.title,
      status: 'accepted',
    });
    if (alreadySaved) {
      throw new ConflictException('You already have this recipe in your cookbook');
    }

    const cloneData = {
      title: sourceRecipe.title,
      userid: userId,
      status: 'accepted',
      shortDescription: sourceRecipe.shortDescription,
      longDescription: sourceRecipe.longDescription,
      hackOrTipIds: sourceRecipe.hackOrTipIds || [],
      heroImageUrl: sourceRecipe.heroImageUrl,
      youtubeId: sourceRecipe.youtubeId,
      portions: sourceRecipe.portions,
      prepCookTime: sourceRecipe.prepCookTime,
      stickerId: sourceRecipe.stickerId,
      frameworkCategories: sourceRecipe.frameworkCategories || [],
      sponsorId: sourceRecipe.sponsorId,
      fridgeKeepTime: sourceRecipe.fridgeKeepTime,
      freezeKeepTime: sourceRecipe.freezeKeepTime,
      useLeftoversIn: sourceRecipe.useLeftoversIn || [],
      components: sourceRecipe.components || [],
      isActive: true,
      countries: sourceRecipe.countries || [],
      source: 'link',
      importSource: 'shared',
    };

    const newRecipe = await this.userRecipeModel.create(cloneData);

    // Increment saves count
    await this.sharedRecipeModel.updateOne(
      { _id: new Types.ObjectId(sharedRecipeId) },
      { $inc: { savesCount: 1 } },
    );

    return {
      success: true,
      message: 'Recipe saved to your cookbook!',
      data: newRecipe,
    };
  }

  async getMyShares(userId: string, recipeId: string) {
    const shares = await this.sharedRecipeModel
      .find({
        sharedBy: new Types.ObjectId(userId),
        recipeId: new Types.ObjectId(recipeId),
        isActive: true,
      })
      .select('shareType communityId message likesCount savesCount createdAt')
      .populate({ path: 'communityId', select: 'name' })
      .lean();

    return { success: true, data: shares };
  }

  private async notifyCommunityMembers(
    sharerId: string,
    communityId: string,
    recipeTitle: string,
    sharedRecipeId: string,
  ) {
    const members = await this.communityMemberModel
      .find({
        groupId: new Types.ObjectId(communityId),
        isActive: true,
        userId: { $ne: new Types.ObjectId(sharerId) },
      })
      .select('userId')
      .lean();

    if (members.length === 0) return;

    const group = await this.communityGroupModel
      .findById(communityId)
      .select('name')
      .lean();

    const targetUserIds = members.map((m: any) => String(m.userId));

    await this.notificationService.send({
      title: `New Recipe in ${group?.name || 'your community'}!`,
      body: `Someone shared "${recipeTitle}" — check it out!`,
      targetUserIds,
      priority: 'normal',
      data: {
        type: 'community_recipe',
        sharedRecipeId,
        communityId,
      },
    });
  }
}
