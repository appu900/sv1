/** Result from sending a single batch to Firebase */
export interface BatchSendResult {
  successTokens: string[];
  /** Tokens that failed with a transient error (worth retrying) */
  retryableTokens: string[];
  /** Tokens that are permanently invalid and should be deactivated */
  invalidTokens: string[];
}

/** Aggregated result after processing all batches for one notification */
export interface NotificationSendResult {
  totalTargets: number;
  successCount: number;
  failureCount: number;
  /** Tokens that should be retried in the next attempt */
  retryableTokens: string[];
  /** Tokens that were permanently deactivated */
  invalidTokens: string[];
}

/** Payload shape sent to Firebase for each message */
export interface FirebaseMessagePayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  /** APNs-specific overrides */
  apns?: {
    sound?: string;
    badge?: number;
    category?: string;
  };
  /** Android-specific overrides */
  android?: {
    channelId?: string;
    priority?: 'high' | 'normal';
  };
}
