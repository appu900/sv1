export interface BatchSendResult {
  successTokens: string[];
  retryableTokens: string[];
  invalidTokens: string[];
}
export interface NotificationSendResult {
  totalTargets: number;
  successCount: number;
  failureCount: number;
  retryableTokens: string[];
  invalidTokens: string[];
}

export interface FirebaseMessagePayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  apns?: {
    sound?: string;
    badge?: number;
    category?: string;
  };
  android?: {
    channelId?: string;
    priority?: 'high' | 'normal';
  };
}
export interface FanOutJobData {
  type: 'fan-out';
  notificationId: string;
}

export interface TokenWithType {
  token: string;
  tokenType: 'apns' | 'fcm' | 'expo';
}

export interface SendBatchJobData {
  type: 'send-batch';
  notificationId: string;
  tokens: TokenWithType[];
  batchIndex: number;
  totalBatches: number;
  /** How many times this batch has already been re-queued for retryable tokens. */
  retryDepth?: number;
}

export type NotificationJobData = FanOutJobData | SendBatchJobData;