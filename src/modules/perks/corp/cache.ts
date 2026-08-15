/**
 * RedisService configures ioredis with `maxRetriesPerRequest: null` plus the
 * default offline queue, so a command issued while Redis is unreachable never
 * settles — it queues indefinitely instead of rejecting (verified: a GET was
 * still pending after 8s against a black-holed host). A plain try/catch cannot
 * protect a request path from that; only a timeout can.
 *
 * Perks uses Redis purely as a cache, so every access is bounded here. If it
 * does not answer promptly the caller carries on without it — a slower request
 * beats a hung one.
 */
export const CACHE_TIMEOUT_MS = 1500;

/**
 * Runs a cache operation, resolving to `null` if it fails OR does not answer in
 * time. `null` means "cache unavailable", which callers treat as a miss.
 */
export async function cacheAttempt<T>(
  operation: () => Promise<T>,
  timeoutMs: number = CACHE_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
