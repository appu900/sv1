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

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name)
    private readonly feedbackModel: Model<FeedbackDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
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
    if (!createFeedbackDto.prompted && createFeedbackDto.data?.food_saved) {
      this.eventEmitter.emit('food.saved', {
        userId,
        foodSavedInGrams: createFeedbackDto.data.food_saved * 1000, // Convert kg to grams
        ingredinatIds: [],
        timestamp: new Date(),
        frameworkId: createFeedbackDto.framework_id,
      } as FoodSavedEvent);
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
}
