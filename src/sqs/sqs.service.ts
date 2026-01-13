import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { CacheInvalidationEvent } from 'src/contracts/cache-invalidation.event';

@Injectable()
export class SqsService implements OnModuleInit {
  private readonly client: SQSClient;
  private readonly queueURL: string;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    if (!process.env.AWS_REGION) {
      throw new Error('AWS_REGION environment variable is required');
    }
    if (!process.env.SQS_URL) {
      throw new Error('SQS_URL environment variable is required');
    }
    this.queueURL = process.env.SQS_URL;
    this.client = new SQSClient({
      region: process.env.AWS_REGION,
      maxAttempts: 3,
    });
  }

  onModuleInit() {
    this.logger.info('SqsService init', {
      region: process.env.AWS_REGION,
      queueURL: this.queueURL,
    });
  }


  getQueueInfo():{queueURL:string,region:string}{
    return {
        queueURL:this.queueURL,
        region:process.env.AWS_REGION!
    }
  }

  async publishCacheInvalidation(event: CacheInvalidationEvent): Promise<void> {
    const startTime = Date.now();
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueURL,
        MessageBody: JSON.stringify(event),
        MessageAttributes: {
          baseKey: {
            DataType: 'String',
            StringValue: event.baseKey,
          },
          timestamp: {
            DataType: 'Number',
            StringValue: event.timestamp.toString(),
          },
          versionCount: {
            DataType: 'Number',
            StringValue: event.invalidateVersions.length.toString(),
          },
        },
      });
      const response = await this.client.send(command);
      const duration = Date.now() - startTime;
      this.logger.info('Cache invalidation published successfully', {
        baseKey: event.baseKey,
        versions: event.invalidateVersions,
        messageId: response.MessageId,
        duration: `${duration}ms`,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to publish cache invalidation', {
        baseKey: event.baseKey,
        versions: event.invalidateVersions,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration: `${duration}ms`,
      });
    }
  }
}
