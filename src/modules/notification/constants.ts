export const FCM_BATCH_SIZE = 500;

export const MAX_RETRIES = 3;

export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000];

export const TOKEN_FAILURE_THRESHOLD = 3;

export const PROCESSOR_CRON = '*/30 * * * * *';

export const LOCK_PREFIX = 'notif:lock:';

export const LOCK_TTL_SECONDS = 300;

export const BROADCAST_RATE_KEY = 'notif:broadcast:last';

export const BROADCAST_COOLDOWN_SECONDS = 300;

export const UNREGISTERED_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

export const TRANSIENT_ERROR_CODES = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/too-many-requests',
  'messaging/unavailable',
]);
