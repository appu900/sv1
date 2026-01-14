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

@Injectable()
export class RecipeRatingsService {
  constructor(
    @InjectModel(RecipeRating.name)
    private recipeRatingModel: Model<RecipeRatingDocument>,
  ) {}

  async create(
    userId: string,
    createRecipeRatingDto: CreateRecipeRatingDto,
  ): Promise<RecipeRating> {
    // Validate rating value (1-5)
    if (createRecipeRatingDto.rating < 1 || createRecipeRatingDto.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
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
    });

    return await recipeRating.save();
  }

  async findAll(): Promise<RecipeRating[]> {
    return await this.recipeRatingModel
      .find()
      .populate('userId', 'name email')
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
      .sort({ createdAt: -1 })
      .lean();
  }

  async findByUser(userId: string): Promise<RecipeRating[]> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException(`Invalid user ID "${userId}"`);
    }

    return await this.recipeRatingModel
      .find({ userId: new Types.ObjectId(userId) })
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
      .lean();
  }

  async getRecipeRatingStats(recipeId: string): Promise<{
    totalRatings: number;
    averageRating: number;
    ratingDistribution: { rating: number; count: number; percentage: number }[];
  }> {
    if (!isValidObjectId(recipeId)) {
      throw new BadRequestException(`Invalid recipe ID "${recipeId}"`);
    }

    const ratings = await this.recipeRatingModel
      .find({ recipeId: new Types.ObjectId(recipeId) })
      .lean();

    const totalRatings = ratings.length;

    if (totalRatings === 0) {
      return {
        totalRatings: 0,
        averageRating: 0,
        ratingDistribution: [
          { rating: 5, count: 0, percentage: 0 },
          { rating: 4, count: 0, percentage: 0 },
          { rating: 3, count: 0, percentage: 0 },
          { rating: 2, count: 0, percentage: 0 },
          { rating: 1, count: 0, percentage: 0 },
        ],
      };
    }

    // Calculate rating distribution
    const distribution = ratings.reduce((acc, rating: any) => {
      const ratingValue = rating.rating || 0;
      acc[ratingValue] = (acc[ratingValue] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Create distribution array with percentages
    const ratingDistribution = [5, 4, 3, 2, 1].map(rating => ({
      rating,
      count: distribution[rating] || 0,
      percentage: Math.round(((distribution[rating] || 0) / totalRatings) * 100),
    }));

    // Calculate average rating
    const sumRatings = ratings.reduce((sum, r: any) => sum + (r.rating || 0), 0);
    const averageRating = Math.round((sumRatings / totalRatings) * 10) / 10; // Round to 1 decimal

    return {
      totalRatings,
      averageRating,
      ratingDistribution,
    };
  }

  async findOne(id: string): Promise<RecipeRating> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating ID "${id}"`);
    }

    const recipeRating = await this.recipeRatingModel
      .findById(id)
      .populate('userId', 'name email')
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

    // Validate rating if being updated
    if (updateRecipeRatingDto.rating !== undefined) {
      if (updateRecipeRatingDto.rating < 1 || updateRecipeRatingDto.rating > 5) {
        throw new BadRequestException('Rating must be between 1 and 5');
      }
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
