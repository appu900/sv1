
export const CACHE_TIMEOUT_MS = 1500;

const CIRCUIT_COOLDOWN_MS = 30_000;

let circuitOpenedAt: number | null = null;

const circuitIsOpen = () =>
  circuitOpenedAt !== null && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS;

export function resetCacheCircuit() {
  circuitOpenedAt = null;
}

export function cacheCircuitIsOpen() {
  return circuitIsOpen();
}

export async function cacheAttempt<T>(
  operation: () => Promise<T>,
  timeoutMs: number = CACHE_TIMEOUT_MS,
): Promise<T | null> {
  if (circuitIsOpen()) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);

    if (result === TIMED_OUT) {
      circuitOpenedAt = Date.now();
      return null;
    }

    // A healthy response closes the circuit again.
    circuitOpenedAt = null;
    return result as T;
  } catch {
    circuitOpenedAt = Date.now();
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TIMED_OUT = Symbol('cache-timeout');
