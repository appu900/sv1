import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId, Types } from 'mongoose';
import { RecipeRating, RecipeRatingDocument } from 'src/database/schemas/recipe-rating.schema';
import { CreateRecipeRatingDto } from './dto/create-recipe-rating.dto';
import { UpdateRecipeRatingDto } from './dto/update-recipe-rating.dto';
import { RatingTagsService } from '../rating-tags/rating-tags.service';

@Injectable()
export class RecipeRatingsService {
  constructor(
    @InjectModel(RecipeRating.name)
    private recipeRatingModel: Model<RecipeRatingDocument>,
    private ratingTagsService: RatingTagsService,
  ) {}

  async create(
    userId: string,
    createRecipeRatingDto: CreateRecipeRatingDto,
  ): Promise<RecipeRating> {
    // Verify that the rating tag exists
    const ratingTag = await this.ratingTagsService.findOne(
      createRecipeRatingDto.ratingTagId,
    );

    if (!ratingTag.isActive) {
      throw new BadRequestException('Selected rating tag is not active');
    }

    // Check if user has already rated this recipe
    const existingRating = await this.recipeRatingModel.findOne({
      userId: new Types.ObjectId(userId),
      recipeId: new Types.ObjectId(createRecipeRatingDto.recipeId),
    });

    if (existingRating) {
      throw new ConflictException(
        'You have already rated this recipe. Use update instead.',
      );
    }

    const recipeRating = new this.recipeRatingModel({
      ...createRecipeRatingDto,
      userId: new Types.ObjectId(userId),
      recipeId: new Types.ObjectId(createRecipeRatingDto.recipeId),
      ratingTagId: new Types.ObjectId(createRecipeRatingDto.ratingTagId),
    });

    return await recipeRating.save();
  }

  async findAll(): Promise<RecipeRating[]> {
    return await this.recipeRatingModel
      .find()
      .populate('userId', 'name email')
      .populate('ratingTagId')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findByRecipe(recipeId: string): Promise<RecipeRating[]> {
    if (!isValidObjectId(recipeId)) {
      throw new BadRequestException(`Invalid recipe ID "${recipeId}"`);
    }

    return await this.recipeRatingModel
      .find({ recipeId: new Types.ObjectId(recipeId) })
      .populate('userId', 'name email')
      .populate('ratingTagId')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findByUser(userId: string): Promise<RecipeRating[]> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException(`Invalid user ID "${userId}"`);
    }

    return await this.recipeRatingModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('ratingTagId')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findUserRatingForRecipe(
    userId: string,
    recipeId: string,
  ): Promise<RecipeRating | null> {
    if (!isValidObjectId(userId) || !isValidObjectId(recipeId)) {
      return null;
    }

    return await this.recipeRatingModel
      .findOne({
        userId: new Types.ObjectId(userId),
        recipeId: new Types.ObjectId(recipeId),
      })
      .populate('ratingTagId')
      .lean();
  }

  async getRecipeRatingStats(recipeId: string): Promise<{
    totalRatings: number;
    ratingBreakdown: Array<{ tagName: string; count: number; order: number }>;
    averageRatingOrder: number;
  }> {
    if (!isValidObjectId(recipeId)) {
      throw new BadRequestException(`Invalid recipe ID "${recipeId}"`);
    }

    const ratings = await this.recipeRatingModel
      .find({ recipeId: new Types.ObjectId(recipeId) })
      .populate('ratingTagId')
      .lean();

    const ratingBreakdown = ratings.reduce((acc, rating: any) => {
      const tagName = rating.ratingTagId?.name || 'Unknown';
      const tagOrder = rating.ratingTagId?.order || 0;
      const existing = acc.find((item) => item.tagName === tagName);

      if (existing) {
        existing.count++;
      } else {
        acc.push({
          tagName,
          count: 1,
          order: tagOrder,
        });
      }

      return acc;
    }, [] as Array<{ tagName: string; count: number; order: number }>);

    // Sort by order descending
    ratingBreakdown.sort((a, b) => b.order - a.order);

    const totalRatings = ratings.length;
    const averageRatingOrder =
      totalRatings > 0
        ? ratings.reduce((sum, r: any) => sum + (r.ratingTagId?.order || 0), 0) /
          totalRatings
        : 0;

    return {
      totalRatings,
      ratingBreakdown,
      averageRatingOrder,
    };
  }

  async findOne(id: string): Promise<RecipeRating> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating ID "${id}"`);
    }

    const recipeRating = await this.recipeRatingModel
      .findById(id)
      .populate('userId', 'name email')
      .populate('ratingTagId')
      .lean();

    if (!recipeRating) {
      throw new NotFoundException(`Recipe rating with ID "${id}" not found`);
    }

    return recipeRating;
  }

  async update(
    id: string,
    userId: string,
    updateRecipeRatingDto: UpdateRecipeRatingDto,
  ): Promise<RecipeRating> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating ID "${id}"`);
    }

    const recipeRating = await this.recipeRatingModel.findById(id);

    if (!recipeRating) {
      throw new NotFoundException(`Recipe rating with ID "${id}" not found`);
    }

    // Verify user owns this rating
    if (recipeRating.userId.toString() !== userId) {
      throw new BadRequestException('You can only update your own ratings');
    }

    // Verify rating tag if being updated
    if (updateRecipeRatingDto.ratingTagId) {
      const ratingTag = await this.ratingTagsService.findOne(
        updateRecipeRatingDto.ratingTagId,
      );

      if (!ratingTag.isActive) {
        throw new BadRequestException('Selected rating tag is not active');
      }

      updateRecipeRatingDto.ratingTagId = new Types.ObjectId(
        updateRecipeRatingDto.ratingTagId,
      ) as any;
    }

    Object.assign(recipeRating, updateRecipeRatingDto);
    return await recipeRating.save();
  }

  async remove(id: string, userId: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating ID "${id}"`);
    }

    const recipeRating = await this.recipeRatingModel.findById(id);

    if (!recipeRating) {
      throw new NotFoundException(`Recipe rating with ID "${id}" not found`);
    }

    // Verify user owns this rating
    if (recipeRating.userId.toString() !== userId) {
      throw new BadRequestException('You can only delete your own ratings');
    }

    await recipeRating.deleteOne();
  }
}
