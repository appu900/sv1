import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { CacheInvalidationEvent } from 'src/contracts/cache-invalidation.event';
import {
  createSqsClient,
  regionFromSqsQueueUrl,
} from './create-sqs-client';

@Injectable()
export class SqsService implements OnModuleInit {
  private readonly client: SQSClient;
  private readonly queueURL: string;
  private readonly region: string;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    if (!process.env.SQS_URL) {
      throw new Error('SQS_URL environment variable is required');
    }
    this.queueURL = process.env.SQS_URL;
    this.region =
      regionFromSqsQueueUrl(this.queueURL) ?? process.env.AWS_REGION ?? '';
    if (!this.region) {
      throw new Error(
        'Could not resolve SQS region from SQS_URL or AWS_REGION',
      );
    }
    this.client = createSqsClient(this.queueURL);
  }

  onModuleInit() {
    this.logger.info('SqsService init', {
      region: this.region,
      queueURL: this.queueURL,
    });
  }

  getQueueInfo(): { queueURL: string; region: string } {
    return {
      queueURL: this.queueURL,
      region: this.region,
    };
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
