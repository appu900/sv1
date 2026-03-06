import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CookbookaiService } from './cookbookai.service';
import { NotificationService } from '../notification/notification.service';
import { CookbookaiJobData } from './cookbookai.interfaces';
import {
  COOKBOOKAI_QUEUE_NAME,
  COOKBOOKAI_WORKER_CONCURRENCY,
} from './cookbookai.constants';

@Processor(COOKBOOKAI_QUEUE_NAME, {
  concurrency: COOKBOOKAI_WORKER_CONCURRENCY,
})
export class CookbookaiWorker extends WorkerHost {
  private readonly logger = new Logger(CookbookaiWorker.name);

  constructor(
    private readonly cookbookaiService: CookbookaiService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async process(job: Job<CookbookaiJobData>): Promise<void> {
    const { userId, message, recipeId } = job.data;
    this.logger.log(
      `[job=${job.id}] Processing recipe extraction for user=${userId}`,
    );

    try {
      // Step 1: Run AI extraction
      const aiResponse =
        await this.cookbookaiService.extractRecipeWithAI(message);

      if (!aiResponse.success) {
        this.logger.warn(
          `[job=${job.id}] AI extraction failed: ${aiResponse.message}`,
        );

        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }

        await this.notificationService.sendToUser(
          userId,
          'Recipe Generation Failed',
          aiResponse.message || 'We couldn\'t extract a recipe from that link. Please try a different link.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
        return;
      }

      // Step 2: Save/update the recipe
      const recipeData = { ...aiResponse.data, userid: userId };
      let createResponse = recipeId
        ? await this.cookbookaiService.updatePendingRecipe(recipeId, userId, recipeData)
        : await this.cookbookaiService.createRecipe(recipeData);

      // If linked pending row was not found, fallback to create a fresh accepted
      // recipe so users still get output, then mark stale pending as rejected.
      if (!createResponse.success || !createResponse.data) {
        this.logger.warn(`[job=${job.id}] update/create primary path failed, trying fallback create`);
        createResponse = await this.cookbookaiService.createRecipe(recipeData);
        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }
      }

      if (!createResponse.success || !createResponse.data) {
        this.logger.error(
          `[job=${job.id}] Recipe save failed for user=${userId}`,
        );

        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }

        await this.notificationService.sendToUser(
          userId,
          'Recipe Save Failed',
          'We extracted the recipe but couldn\'t save it. Please try again.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
        return;
      }

      // Step 3: Send success notification
      const doc: any = createResponse.data;
      const savedRecipeId = String(doc._id || doc.id);
      const recipeTitle = doc.title || 'Your Recipe';

      this.logger.log(
        `[job=${job.id}] Recipe created: id=${savedRecipeId}, title="${recipeTitle}"`,
      );

      await this.notificationService.sendToUser(
        userId,
        '🍳 Recipe Ready!',
        `"${recipeTitle}" has been added to your cookbook. Tap to view it!`,
        {
          type: 'cookbookai',
          action: 'recipe_added',
          recipeId: savedRecipeId,
        },
        `saveful://cookbook/recipe/${savedRecipeId}`,
      );

      this.logger.log(
        `[job=${job.id}] Notification sent to user=${userId} for recipe=${savedRecipeId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[job=${job.id}] Unexpected error: ${error?.message}`,
        error?.stack,
      );

      if (recipeId) {
        await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
      }

      // Best-effort notification on unexpected failure
      try {
        await this.notificationService.sendToUser(
          userId,
          'Recipe Generation Failed',
          'Something went wrong while generating your recipe. Please try again.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
      } catch (notifErr: any) {
        this.logger.error(
          `[job=${job.id}] Failed to send error notification: ${notifErr?.message}`,
        );
      }

      throw error; // Re-throw so BullMQ can retry
    }
  }
}
