import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Feedback, FeedbackDocument } from 'src/database/schemas/feedback.schema';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FoodSavedEvent } from '../analytics/analytics.service';
import {
  Ingredient,
  IngredientDocument,
} from 'src/database/schemas/ingredient.schema';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<FeedbackDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, createFeedbackDto: CreateFeedbackDto) {
    console.log('[FeedbackService] Create called with:', {
      userId,
      createDto: JSON.stringify(createFeedbackDto),
    });

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    // Check if feedback already exists for this user and meal_id (unique cooking session)
    // Previously checked framework_id which caused duplicate cooking sessions to update instead of create
    const existingFeedback = await this.feedbackModel.findOne({
      userId: new Types.ObjectId(userId),
      'data.meal_id': createFeedbackDto.data?.meal_id,
    });

    if (existingFeedback) {
      console.log('[FeedbackService] Found existing feedback, updating instead of creating new');
      
      // Update existing feedback
      existingFeedback.prompted = createFeedbackDto.prompted || existingFeedback.prompted;
      existingFeedback.data = {
        ...existingFeedback.data,
        ...createFeedbackDto.data,
      };
      existingFeedback.markModified('data');
      existingFeedback.updatedAt = new Date();
      
      await existingFeedback.save();
      
      console.log('[FeedbackService] Feedback updated with data:', JSON.stringify(existingFeedback.data));

      // Emit food.saved event if food_saved is provided and differs
      // Check if this is a prompted:false submission (initial cook completion)
      if (!createFeedbackDto.prompted && createFeedbackDto.data?.food_saved !== undefined) {
        const previousFoodSaved = existingFeedback.data?.food_saved || 0;
        const newFoodSaved = createFeedbackDto.data.food_saved;
        const difference = newFoodSaved - previousFoodSaved;

        // Emit event with the difference to avoid double-counting
        if (difference !== 0) {
          this.eventEmitter.emit('food.saved', {
            userId,
            foodSavedInGrams: difference * 1000,
            ingredinatIds: [],
            timestamp: new Date(),
            frameworkId: createFeedbackDto.framework_id,
          } as FoodSavedEvent);
        }
      }

      return { feedback: existingFeedback };
    }

    // Create new feedback if none exists
    const feedback = await this.feedbackModel.create({
      userId: new Types.ObjectId(userId),
      framework_id: createFeedbackDto.framework_id,
      prompted: createFeedbackDto.prompted || false,
      data: createFeedbackDto.data || {},
    });

    console.log('[FeedbackService] Feedback created with data:', JSON.stringify(feedback.data));

    // Emit food.saved event ONLY when user initially completes cooking (prompted: false)
    // This ensures analytics are tracked when user finishes in MakeItSurveyModal
    // For PostMakeScreen surveys (prompted: true), analytics are tracked separately via saveFoodAnalytics
    if (!createFeedbackDto.prompted && createFeedbackDto.data?.food_saved !== undefined) {
      console.log('[FeedbackService] Emitting food.saved event:', {
        userId,
        foodSavedInGrams: createFeedbackDto.data.food_saved * 1000,
        frameworkId: createFeedbackDto.framework_id,
      });
      this.eventEmitter.emit('food.saved', {
        userId,
        foodSavedInGrams: createFeedbackDto.data.food_saved * 1000, // Convert kg to grams
        ingredinatIds: [],
        timestamp: new Date(),
        frameworkId: createFeedbackDto.framework_id,
      } as FoodSavedEvent);
    } else {
      console.log('[FeedbackService] NOT emitting food.saved event. prompted:', createFeedbackDto.prompted, 'food_saved:', createFeedbackDto.data?.food_saved);
    }

    return { feedback };
  }

  async findAll(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const feedbacks = await this.feedbackModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    return { feedbacks };
  }

  async findOne(feedbackId: string, userId: string) {
    if (!Types.ObjectId.isValid(feedbackId)) {
      throw new BadRequestException('Invalid feedback ID');
    }

    const feedback = await this.feedbackModel
      .findById(new Types.ObjectId(feedbackId))
      .lean();

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    // Ensure user owns this feedback
    if (feedback.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return { feedback };
  }

  async update(
    feedbackId: string,
    userId: string,
    updateFeedbackDto: UpdateFeedbackDto,
  ) {
    console.log('[FeedbackService] Update called with:', {
      feedbackId,
      userId,
      updateDto: JSON.stringify(updateFeedbackDto),
    });

    if (!Types.ObjectId.isValid(feedbackId)) {
      throw new BadRequestException('Invalid feedback ID');
    }

    const feedback = await this.feedbackModel.findById(
      new Types.ObjectId(feedbackId),
    );

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    // Ensure user owns this feedback
    if (feedback.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    console.log('[FeedbackService] Existing feedback data:', JSON.stringify(feedback.data));

    // Update fields
    if (updateFeedbackDto.prompted !== undefined) {
      feedback.prompted = updateFeedbackDto.prompted;
    }

    if (updateFeedbackDto.data) {
      feedback.data = {
        ...feedback.data,
        ...updateFeedbackDto.data,
      };
      
      // Mark the data field as modified for Mongoose to persist nested changes
      feedback.markModified('data');

      console.log('[FeedbackService] Updated feedback data:', JSON.stringify(feedback.data));

      if (updateFeedbackDto.data.food_saved !== undefined) {
        const previousFoodSaved = feedback.data.food_saved || 0;
        const newFoodSaved = updateFeedbackDto.data.food_saved;
        const difference = newFoodSaved - previousFoodSaved;

        if (difference !== 0) {
          this.eventEmitter.emit('food.saved', {
            userId,
            foodSavedInGrams: difference * 1000, 
            ingredinatIds: [],
            timestamp: new Date(),
            frameworkId: feedback.framework_id,
          } as FoodSavedEvent);
        }
      }
    }

    feedback.updatedAt = new Date();
    await feedback.save();

    console.log('[FeedbackService] Feedback saved, final data:', JSON.stringify(feedback.data));

    return { feedback };
  }

  async delete(feedbackId: string, userId: string) {
    if (!Types.ObjectId.isValid(feedbackId)) {
      throw new BadRequestException('Invalid feedback ID');
    }

    const feedback = await this.feedbackModel.findById(
      new Types.ObjectId(feedbackId),
    );

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    // Ensure user owns this feedback
    if (feedback.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.feedbackModel.deleteOne({ _id: new Types.ObjectId(feedbackId) });

    return { message: 'Feedback deleted successfully' };
  }

  async adminDelete(feedbackId: string) {
    if (!Types.ObjectId.isValid(feedbackId)) {
      throw new BadRequestException('Invalid feedback ID');
    }

    const feedback = await this.feedbackModel.findById(
      new Types.ObjectId(feedbackId),
    );

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    await this.feedbackModel.deleteOne({ _id: new Types.ObjectId(feedbackId) });

    return { message: 'Feedback deleted successfully' };
  }

  async getStats(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const feedbacks = await this.feedbackModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean();

    const totalFeedbacks = feedbacks.length;
    const totalFoodSaved = feedbacks.reduce(
      (sum, f) => sum + (f.data?.food_saved || 0),
      0,
    );

    return {
      stats: {
        total_feedbacks: totalFeedbacks,
        total_food_saved: totalFoodSaved,
      },
    };
  }

  // Admin methods
  async getAllFeedbacksWithDetails() {
    const feedbacks = await this.feedbackModel
      .find()
      .sort({ createdAt: -1 })
      .lean();

    // Populate user and recipe details
    const feedbacksWithDetails = await Promise.all(
      feedbacks.map(async (feedback) => {
        const user = await this.userModel
          .findById(feedback.userId)
          .select('name email')
          .lean();
        
        const recipe = await this.recipeModel
          .findById(feedback.framework_id)
          .select('title heroImageUrl')
          .lean();

        return {
          ...feedback,
          user: user ? { name: user.name, email: user.email } : null,
          recipe: recipe ? { title: recipe.title, heroImageUrl: recipe.heroImageUrl } : null,
        };
      }),
    );

    return { feedbacks: feedbacksWithDetails };
  }

  async getFeedbacksByRecipe(recipeId: string) {
    if (!Types.ObjectId.isValid(recipeId)) {
      throw new BadRequestException('Invalid recipe ID');
    }

    const feedbacks = await this.feedbackModel
      .find({ framework_id: recipeId })
      .sort({ createdAt: -1 })
      .lean();

    // Populate user and recipe details
    const feedbacksWithDetails = await Promise.all(
      feedbacks.map(async (feedback) => {
        const user = await this.userModel
          .findById(feedback.userId)
          .select('name email')
          .lean();
        
        const recipe = await this.recipeModel
          .findById(feedback.framework_id)
          .select('title heroImageUrl')
          .lean();

        return {
          ...feedback,
          user: user ? { name: user.name, email: user.email } : null,
          recipe: recipe ? { title: recipe.title, heroImageUrl: recipe.heroImageUrl } : null,
        };
      }),
    );

    return { feedbacks: feedbacksWithDetails };
  }

  async getAdminStats() {
    const allFeedbacks = await this.feedbackModel.find().lean();

    const totalFeedbacks = allFeedbacks.length;
    const withRatings = allFeedbacks.filter((f) => f.data?.rating).length;
    const withReviews = allFeedbacks.filter((f) => f.data?.review && f.data.review.trim().length > 0).length;
    
    const ratings = allFeedbacks
      .map((f) => f.data?.rating)
      .filter((r) => r !== undefined && r !== null);
    
    const averageRating = ratings.length > 0 
      ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length 
      : 0;

    // Calculate rating distribution
    const ratingDistribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: allFeedbacks.filter((f) => f.data?.rating === rating).length,
    }));

    return {
      totalFeedbacks,
      withRatings,
      withReviews,
      averageRating: Math.round(averageRating * 10) / 10,
      ratingDistribution,
    };
  }
}
