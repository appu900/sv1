import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CookbookaiJobData } from './cookbookai.interfaces';
import {
  COOKBOOKAI_QUEUE_NAME,
  COOKBOOKAI_JOB_ATTEMPTS,
  COOKBOOKAI_JOB_BACKOFF_TYPE,
  COOKBOOKAI_JOB_BACKOFF_DELAY,
  COOKBOOKAI_JOB_REMOVE_ON_COMPLETE,
  COOKBOOKAI_JOB_REMOVE_ON_FAIL,
} from './cookbookai.constants';

@Injectable()
export class CookbookaiProducer {
  private readonly logger = new Logger(CookbookaiProducer.name);

  constructor(
    @InjectQueue(COOKBOOKAI_QUEUE_NAME)
    private readonly queue: Queue<CookbookaiJobData>,
  ) {}

  async enqueueRecipeExtraction(
    userId: string,
    message: string,
    recipeId?: string,
  ): Promise<string> {
    const jobData: CookbookaiJobData = {
      type: 'extract-recipe',
      userId,
      message,
      recipeId,
    };

    const job = await this.queue.add('extract-recipe', jobData, {
      attempts: COOKBOOKAI_JOB_ATTEMPTS,
      backoff: {
        type: COOKBOOKAI_JOB_BACKOFF_TYPE,
        delay: COOKBOOKAI_JOB_BACKOFF_DELAY,
      },
      removeOnComplete: COOKBOOKAI_JOB_REMOVE_ON_COMPLETE,
      removeOnFail: COOKBOOKAI_JOB_REMOVE_ON_FAIL,
    });

    this.logger.log(
      `Recipe extraction job enqueued: jobId=${job.id}, userId=${userId}`,
    );

    return job.id!;
  }

  async enqueueRecipeFromIngredients(
    userId: string,
    ingredients: string[],
    preference: string | undefined,
    recipeId: string,
  ): Promise<string> {
    const jobData: CookbookaiJobData = {
      type: 'generate-from-ingredients',
      userId,
      message: '',
      recipeId,
      ingredients,
      preference,
    };

    const job = await this.queue.add('generate-from-ingredients', jobData, {
      attempts: COOKBOOKAI_JOB_ATTEMPTS,
      backoff: {
        type: COOKBOOKAI_JOB_BACKOFF_TYPE,
        delay: COOKBOOKAI_JOB_BACKOFF_DELAY,
      },
      removeOnComplete: COOKBOOKAI_JOB_REMOVE_ON_COMPLETE,
      removeOnFail: COOKBOOKAI_JOB_REMOVE_ON_FAIL,
    });

    this.logger.log(
      `Recipe from ingredients job enqueued: jobId=${job.id}, userId=${userId}`,
    );

    return job.id!;
  }
}
