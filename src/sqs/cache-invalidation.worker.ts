import { ErrorDocument$ } from '@aws-sdk/client-s3';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { RedisService } from 'src/redis/redis.service';
import { Logger } from 'winston';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CacheInvalidationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;
  private workerPromise: Promise<void> | null = null;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    if (!process.env.SQS_URL) {
      throw new Error('SQS_URL environment variable is required');
    }
    if (!process.env.AWS_REGION) {
      throw new Error('AWS_REGION environment variable is required');
    }

    this.queueUrl = process.env.SQS_URL;
    this.client = new SQSClient({
      region: process.env.AWS_REGION,
      maxAttempts: 3,
    });
  }

  async onModuleInit() {
    this.logger.info('CacheInvalidationWorkerService initializing', {
      queueUrl: this.queueUrl,
      region: process.env.AWS_REGION,
    });
  }

  async onModuleDestroy() {
    this.logger.info('CacheInvalidationWorkerService destroying', {
      processedCount: this.processedCount,
      failedCount: this.failedCount,
    });

    // await this.stop();
  }

  //   ** start the worker broooo
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('worker is already working');
      return;
    }
    this.isRunning = true;
    this.logger.info('cache invalidation worker started');
    while (this.isRunning) {
      try {
        await this.pollAndProcessMessages();
      } catch (error) {
        this.logger.error('Error in worker polling loop', {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
        await this.sleep(5000);
      }

      this.logger.info('Cache invalidation worker stopped', {
        totalProcessed: this.processedCount,
        totalFailed: this.failedCount,
      });
    }
  }

  private async pollAndProcessMessages(): Promise<void> {
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 60,
          MessageAttributeNames: ['All'],
        }),
      );
      if (!response.Messages?.length) return;
      this.logger.info(
        `Received ${response.Messages.length} messages from SQS`,
      );
      for (const message of response.Messages) {
        await this.processMessage(message);
      }
    } catch (error) {}
  }

  private async processMessage(message: Message): Promise<void> {
    try {
      if (!message.Body || !message.ReceiptHandle)
        throw new Error('invalid sqs message');
      const event = JSON.parse(message.Body);
      await this.routeEvent(event);
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      this.processedCount++;
    } catch (error) {
      this.failedCount++;
      this.logger.error('failed tp prrocess message', {
        error: error instanceof Error ? error.message : 'unknown error',
        body: message.Body,
      });
    }
  }

  private async routeEvent(event: any) {
    switch (event.eventType) {
      case 'CACHE_INVALIDATION':
        await this.handleCacheInvalidation(event.payload);
        break;
      default:
        this.logger.warn('Unknown event type recived at SQS worker', {
          eventType: event.eventType,
        });
    }
  }

  private async handleCacheInvalidation(payload: {
    baseKey: string;
    invalidateVersions: number[];
    timestamp: number;
  }) {
    const { baseKey, invalidateVersions } = payload;
    if (!baseKey || !Array.isArray(invalidateVersions)) {
      throw new Error('Invalid cache invalidation payload');
    }
    for (const version of invalidateVersions) {
      await this.redisService.deleteVersion(baseKey, version);
      this.logger.info('Cache version invalidated', {
        key: `${baseKey}:v${version}`,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
