import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Favourite, FavouriteDocument } from 'src/database/schemas/favourite.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';
import { Hacks, HackDocument } from 'src/database/schemas/hacks.schema';
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
  ) {}

  async create(userId: string, createFavouriteDto: CreateFavouriteDto) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    // Check if already exists
    const existing = await this.favouriteModel.findOne({
      userId: new Types.ObjectId(userId),
      framework_id: createFavouriteDto.framework_id,
      type: createFavouriteDto.type,
    });

    if (existing) {
      throw new ConflictException('This item is already saved');
    }

    const favourite = await this.favouriteModel.create({
      userId: new Types.ObjectId(userId),
      framework_id: createFavouriteDto.framework_id,
      type: createFavouriteDto.type,
    });

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

    const favourites = await this.favouriteModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

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

    return { success: true };
  }

  async findAllDetailed(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const favourites = await this.favouriteModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    const frameworkIds = favourites
      .filter(f => f.type === 'framework')
      .map(f => f.framework_id);
    const hackIds = favourites
      .filter(f => f.type === 'hack')
      .map(f => f.framework_id);

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

    // Preserve favourite ordering: map back to favourites ordering
    const byId = new Map<string, any>();
    recipeItems.forEach(i => byId.set(i.id, i));
    hackItems.forEach(i => byId.set(i.id, i));

    const ordered = favourites
      .map(f => byId.get(f.framework_id))
      .filter(Boolean);

    return { favourites: ordered };
  }
}
