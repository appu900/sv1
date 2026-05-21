import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Favourite, FavouriteDocument } from 'src/database/schemas/favourite.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';
import { Hacks, HackDocument } from 'src/database/schemas/hacks.schema';
import {
  UserFoodAnalyticsProfile,
  UserFoodAnalyticalProfileDocument,
} from 'src/database/schemas/user.food.analyticsProfile.schema';
import { CreateFavouriteDto } from './dto/create-favourite.dto';

@Injectable()
export class FavouriteService {
  constructor(
    @InjectModel(Favourite.name)
    private readonly favouriteModel: Model<FavouriteDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(Hacks.name)
    private readonly hackModel: Model<HackDocument>,
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly userFoodAnalyticsProfileModel: Model<UserFoodAnalyticalProfileDocument>,
  ) {}

  private async syncSavedItemsForUser(
    userObjectId: Types.ObjectId,
    favourites?: Array<{ type: string; framework_id: string }>,
    options?: { upsert?: boolean },
  ) {
    const savedFavourites = favourites
      ? favourites.filter(
          favourite =>
            favourite.type === 'framework' || favourite.type === 'hack',
        )
      : await this.favouriteModel
          .find({
            userId: userObjectId,
            type: { $in: ['framework', 'hack'] },
          })
          .select('framework_id type')
          .lean();

    const savedRecipeIds = savedFavourites
      .filter(favourite => favourite.type === 'framework')
      .map(favourite => favourite.framework_id)
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id));

    const savedHackIds = savedFavourites
      .filter(favourite => favourite.type === 'hack')
      .map(favourite => favourite.framework_id)
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id));

    await this.userFoodAnalyticsProfileModel.updateOne(
      { userId: userObjectId },
      {
        ...(options?.upsert ? { $setOnInsert: { userId: userObjectId } } : {}),
        $set: {
          savedRecipes: savedRecipeIds,
          savedHacks: savedHackIds,
        },
      },
      options?.upsert ? { upsert: true } : undefined,
    );
  }

  async create(userId: string, createFavouriteDto: CreateFavouriteDto) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(userId);

    // Check if already exists
    const existing = await this.favouriteModel.findOne({
      userId: userObjectId,
      framework_id: createFavouriteDto.framework_id,
      type: createFavouriteDto.type,
    });

    if (existing) {
      if (
        createFavouriteDto.type === 'framework' ||
        createFavouriteDto.type === 'hack'
      ) {
        await this.syncSavedItemsForUser(userObjectId, undefined, {
          upsert: true,
        });
      }

      return {
        favourite: {
          id: existing._id.toString(),
          type: existing.type,
          framework_id: existing.framework_id,
        },
      };
    }

    let favourite = await this.favouriteModel.create({
      userId: userObjectId,
      framework_id: createFavouriteDto.framework_id,
      type: createFavouriteDto.type,
    }).catch(async error => {
      if (error?.code !== 11000) {
        throw error;
      }

      const duplicate = await this.favouriteModel.findOne({
        userId: userObjectId,
        framework_id: createFavouriteDto.framework_id,
        type: createFavouriteDto.type,
      });

      if (!duplicate) {
        throw error;
      }

      return duplicate;
    });

    if (
      createFavouriteDto.type === 'framework' ||
      createFavouriteDto.type === 'hack'
    ) {
      await this.syncSavedItemsForUser(userObjectId, undefined, {
        upsert: true,
      });
    }

    return {
      favourite: {
        id: favourite._id.toString(),
        type: favourite.type,
        framework_id: favourite.framework_id,
      },
    };
  }

  async findAll(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(userId);

    const favourites = await this.favouriteModel
      .find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .lean();

    await this.syncSavedItemsForUser(userObjectId, favourites);

    return {
      favourites: favourites.map((fav) => ({
        id: fav._id.toString(),
        type: fav.type,
        framework_id: fav.framework_id,
      })),
    };
  }

  async remove(favouriteId: string, userId: string) {
    if (!Types.ObjectId.isValid(favouriteId)) {
      throw new BadRequestException('Invalid favourite ID');
    }

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(userId);

    const favourite = await this.favouriteModel.findById(
      new Types.ObjectId(favouriteId),
    );

    if (!favourite) {
      throw new NotFoundException('Favourite not found');
    }

    // Ensure user owns this favourite
    if (favourite.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.favouriteModel.deleteOne({ _id: new Types.ObjectId(favouriteId) });

    if (favourite.type === 'framework' || favourite.type === 'hack') {
      await this.syncSavedItemsForUser(userObjectId);
    }

    return { success: true };
  }

  async findAllDetailed(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(userId);

    const favourites = await this.favouriteModel
      .find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .lean();

    await this.syncSavedItemsForUser(userObjectId, favourites);

    const savedFavourites = favourites
      .filter(f => f.type === 'framework' || f.type === 'hack')
      .map(f => ({
        ...f,
        framework_id: f.framework_id?.toString(),
      }))
      .filter(f => Types.ObjectId.isValid(f.framework_id));

    const frameworkIds = [
      ...new Set(
        savedFavourites
          .filter(f => f.type === 'framework')
          .map(f => f.framework_id),
      ),
    ];
    const hackIds = [
      ...new Set(
        savedFavourites
          .filter(f => f.type === 'hack')
          .map(f => f.framework_id),
      ),
    ];

    const [recipes, hacks] = await Promise.all([
      frameworkIds.length
        ? this.recipeModel
            .find({ _id: { $in: frameworkIds.map(id => new Types.ObjectId(id)) } })
            .select('title heroImageUrl shortDescription')
            .lean()
        : [],
      hackIds.length
        ? this.hackModel
            .find({ _id: { $in: hackIds.map(id => new Types.ObjectId(id)) } })
            .select('title shortDescription thumbnailImageUrl heroImageUrl')
            .lean()
        : [],
    ]);

    const recipeItems = (recipes as any[]).map(r => ({
      id: r._id.toString(),
      type: 'framework' as const,
      title: r.title,
      shortDescription: r.shortDescription,
      heroImageUrl: r.heroImageUrl,
    }));

    const hackItems = (hacks as any[]).map(h => ({
      id: h._id.toString(),
      type: 'hack' as const,
      title: h.title,
      shortDescription: h.shortDescription,
      thumbnailImageUrl: h.thumbnailImageUrl,
      heroImageUrl: h.heroImageUrl,
    }));
    
    const byId = new Map<string, any>();
    recipeItems.forEach(i => byId.set(i.id, i));
    hackItems.forEach(i => byId.set(i.id, i));

    const ordered = savedFavourites
      .map(f => byId.get(f.framework_id))
      .filter(Boolean);

    return { favourites: ordered };
  }
}
