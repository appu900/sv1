import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  BatchSendResult,
  FirebaseMessagePayload,
} from './interfaces';
import {
  FCM_BATCH_SIZE,
  UNREGISTERED_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
} from './constants';

@Injectable()
export class FirebaseGateway implements OnModuleInit {
  private app: admin.app.App;

  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase credentials not configured — push notifications disabled',
        { service: 'FirebaseGateway' },
      );
      return;
    }

    // Handle both escaped (\n literal) and real newlines in the private key
    const resolvedKey = privateKey.includes('\n')
      ? privateKey.replace(/\\n/g, '\n')
      : privateKey;

    this.logger.info('Firebase init attempt', {
      service: 'FirebaseGateway',
      projectId,
      clientEmail,
      keyLength: resolvedKey.length,
      keyStartsWith: resolvedKey.substring(0, 30),
    });

    try {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: resolvedKey,
        }),
      });
      this.logger.info('Firebase Admin SDK initialised successfully', {
        service: 'FirebaseGateway',
        projectId,
      });
    } catch (error) {
      this.logger.error('Firebase Admin SDK init failed', {
        service: 'FirebaseGateway',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  isReady(): boolean {
    return !!this.app;
  }

  async sendToTokens(
    tokens: string[],
    payload: FirebaseMessagePayload,
  ): Promise<BatchSendResult> {
    if (!this.isReady()) {
      this.logger.error('Firebase not initialised — cannot send', {
        service: 'FirebaseGateway',
      });
      return { successTokens: [], retryableTokens: tokens, invalidTokens: [] };
    }

    if (tokens.length === 0) {
      return { successTokens: [], retryableTokens: [], invalidTokens: [] };
    }

    const aggregated: BatchSendResult = {
      successTokens: [],
      retryableTokens: [],
      invalidTokens: [],
    };

    const chunks = this.chunkArray(tokens, FCM_BATCH_SIZE);

    for (const chunk of chunks) {
      const result = await this.sendBatch(chunk, payload);
      aggregated.successTokens.push(...result.successTokens);
      aggregated.retryableTokens.push(...result.retryableTokens);
      aggregated.invalidTokens.push(...result.invalidTokens);
    }

    return aggregated;
  }

  private async sendBatch(
    tokens: string[],
    payload: FirebaseMessagePayload,
  ): Promise<BatchSendResult> {
    const result: BatchSendResult = {
      successTokens: [],
      retryableTokens: [],
      invalidTokens: [],
    };

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      },
      data: payload.data ?? {},
      android: {
        priority: payload.android?.priority === 'normal' ? 'normal' : 'high',
        notification: {
          channelId: payload.android?.channelId ?? 'default',
          sound: 'default',
          icon: 'notification_icon',
          color: '#4B2176',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: payload.apns?.sound ?? 'default',
            ...(payload.apns?.badge !== undefined
              ? { badge: payload.apns.badge }
              : {}),
            ...(payload.apns?.category
              ? { category: payload.apns.category }
              : {}),
          },
        },
      },
    };

    try {
      const response = await admin.messaging(this.app).sendEachForMulticast(message);

      response.responses.forEach((resp, idx) => {
        const token = tokens[idx];
        if (resp.success) {
          result.successTokens.push(token);
        } else {
          const errorCode = resp.error?.code ?? '';
          if (UNREGISTERED_ERROR_CODES.has(errorCode)) {
            result.invalidTokens.push(token);
          } else if (TRANSIENT_ERROR_CODES.has(errorCode)) {
            result.retryableTokens.push(token);
          } else {
            this.logger.warn('Unknown FCM error — treating as retryable', {
              service: 'FirebaseGateway',
              token: token.slice(0, 12) + '…',
              errorCode,
              errorMessage: resp.error?.message,
            });
            result.retryableTokens.push(token);
          }
        }
      });

      this.logger.info('FCM batch result', {
        service: 'FirebaseGateway',
        total: tokens.length,
        success: result.successTokens.length,
        retryable: result.retryableTokens.length,
        invalid: result.invalidTokens.length,
      });
    } catch (error) {
      this.logger.error('FCM batch send threw', {
        service: 'FirebaseGateway',
        error: error instanceof Error ? error.message : String(error),
        tokenCount: tokens.length,
      });
      result.retryableTokens.push(...tokens);
    }

    return result;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
