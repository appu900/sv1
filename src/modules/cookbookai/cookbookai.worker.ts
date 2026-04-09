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
    const { type, userId, message, recipeId, ingredients, preference, country } = job.data;

    if (type === 'generate-from-ingredients') {
      return this.processGenerateFromIngredients(job, userId, recipeId, ingredients || [], preference, country);
    }

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
          'Our servers are busy',
          'We couldn\'t complete your recipe right now. Your generation slot has been restored — please try again in a few minutes.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
        return;
      }

      // Step 2: Save/update the recipe
      const recipeData = { ...aiResponse.data, userid: userId };
      const createResponse = recipeId
        ? await this.cookbookaiService.updatePendingRecipe(recipeId, userId, recipeData)
        : await this.cookbookaiService.createRecipe(recipeData);

      if (!createResponse.success || !createResponse.data) {
        this.logger.error(
          `[job=${job.id}] Recipe save failed for user=${userId}`,
        );

        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }

        await this.notificationService.sendToUser(
          userId,
          'Our servers are busy',
          'We couldn\'t save your recipe right now. Your generation slot has been restored — please try again in a few minutes.',
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
          'Our servers are busy',
          'Our servers are a bit busy right now. Your generation slot has been restored — please try again in a few minutes.',
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

  private async processGenerateFromIngredients(
    job: Job<CookbookaiJobData>,
    userId: string,
    recipeId: string | undefined,
    ingredients: string[],
    preference: string | undefined,
    country: string | undefined,
  ): Promise<void> {
    this.logger.log(
      `[job=${job.id}] Processing recipe from ingredients for user=${userId}, ingredients=${ingredients.length}`,
    );

    try {
      const aiResponse = await this.cookbookaiService.generateRecipeFromIngredients(
        ingredients,
        preference,
        country,
      );

      if (!aiResponse.success) {
        this.logger.warn(`[job=${job.id}] AI generation failed: ${aiResponse.message}`);

        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }

        await this.notificationService.sendToUser(
          userId,
          'Our servers are busy',
          'We couldn\'t complete your recipe right now. Your generation slot has been restored — please try again in a few minutes.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
        return;
      }

      const recipeData = { ...aiResponse.data, userid: userId, source: 'ai_ingredients' };
      const createResponse = recipeId
        ? await this.cookbookaiService.updatePendingRecipe(recipeId, userId, recipeData)
        : await this.cookbookaiService.createRecipe(recipeData);

      // Ensure source is set on the final recipe
      if (createResponse.success && createResponse.data) {
        const finalId = String((createResponse.data as any)._id || (createResponse.data as any).id);
        await this.cookbookaiService.updateRecipeSource(finalId, userId, 'ai_ingredients');
      }

      if (!createResponse.success || !createResponse.data) {
        this.logger.error(`[job=${job.id}] Recipe save failed for user=${userId}`);

        if (recipeId) {
          await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
        }

        await this.notificationService.sendToUser(
          userId,
          'Our servers are busy',
          'We couldn\'t save your recipe right now. Your generation slot has been restored — please try again in a few minutes.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
        return;
      }

      const doc: any = createResponse.data;
      const savedRecipeId = String(doc._id || doc.id);
      const recipeTitle = doc.title || 'Your AI Recipe';

      this.logger.log(
        `[job=${job.id}] AI recipe created: id=${savedRecipeId}, title="${recipeTitle}"`,
      );

      await this.notificationService.sendToUser(
        userId,
        '🍳 AI Recipe Ready!',
        `"${recipeTitle}" has been generated from your ingredients and added to your cookbook!`,
        {
          type: 'cookbookai',
          action: 'recipe_added',
          recipeId: savedRecipeId,
        },
        `saveful://cookbook/recipe/${savedRecipeId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[job=${job.id}] Unexpected error in generateFromIngredients: ${error?.message}`,
        error?.stack,
      );

      if (recipeId) {
        await this.cookbookaiService.setRecipeStatus(recipeId, userId, 'rejected');
      }

      try {
        await this.notificationService.sendToUser(
          userId,
          'Our servers are busy',
          'Our servers are a bit busy right now. Your generation slot has been restored — please try again in a few minutes.',
          { type: 'cookbookai', action: 'failed' },
          'saveful://cookbook',
        );
      } catch (notifErr: any) {
        this.logger.error(
          `[job=${job.id}] Failed to send error notification: ${notifErr?.message}`,
        );
      }

      throw error;
    }
  }
}
