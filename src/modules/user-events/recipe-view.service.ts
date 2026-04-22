import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecipeView,
  RecipeViewDocument,
  RecipeViewSource,
} from '../../database/schemas/recipe-view.schema';
import { Recipe, RecipeDocument } from '../../database/schemas/recipe.schema';
import {
  userRecipe,
  UserRecipeDocument,
} from '../../database/schemas/user.schema';
import { UserEventService } from './user-event.service';
import { UserEventType } from '../../database/schemas/user-event.schema';

@Injectable()
export class RecipeViewService {
  private readonly logger = new Logger(RecipeViewService.name);

  constructor(
    @InjectModel(RecipeView.name)
    private readonly recipeViewModel: Model<RecipeViewDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(userRecipe.name)
    private readonly userRecipeModel: Model<UserRecipeDocument>,
    private readonly userEventService: UserEventService,
  ) {}

  async recordView(
    userId: string,
    recipeId: string,
    source: RecipeViewSource = RecipeViewSource.OTHER,
  ): Promise<{ success: boolean; firstOpen: boolean }> {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return { success: false, firstOpen: false };
    }
    if (!recipeId || !Types.ObjectId.isValid(recipeId)) {
      return { success: false, firstOpen: false };
    }

    const uid = new Types.ObjectId(userId);
    const rid = new Types.ObjectId(recipeId);

    try {
      await this.recipeViewModel.create({
        userId: uid,
        recipeId: rid,
        source,
        viewedAt: new Date(),
      });

      await Promise.all([
        this.recipeModel
          .updateOne({ _id: rid }, { $inc: { viewCount: 1 } })
          .exec()
          .catch(() => null),
        this.userRecipeModel
          .updateOne({ _id: rid }, { $inc: { viewCount: 1 } })
          .exec()
          .catch(() => null),
      ]);

      const firstOpen = await this.userEventService.recordFirst(
        uid,
        UserEventType.FIRST_RECIPE_OPENED,
        { recipeId: rid.toString(), source },
      );

      return { success: true, firstOpen };
    } catch (error) {
      this.logger.error(
        `recordView failed (user=${userId}, recipe=${recipeId}): ${
          (error as Error).message
        }`,
      );
      return { success: false, firstOpen: false };
    }
  }

  async incrementCookCount(recipeId?: string): Promise<void> {
    if (!recipeId || !Types.ObjectId.isValid(recipeId)) return;
    const rid = new Types.ObjectId(recipeId);
    await Promise.all([
      this.recipeModel
        .updateOne({ _id: rid }, { $inc: { cookCount: 1 } })
        .exec()
        .catch(() => null),
      this.userRecipeModel
        .updateOne({ _id: rid }, { $inc: { cookCount: 1 } })
        .exec()
        .catch(() => null),
    ]);
  }
}
