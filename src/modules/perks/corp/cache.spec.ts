import {
  cacheAttempt,
  cacheCircuitIsOpen,
  resetCacheCircuit,
} from './cache';

const hang = () => new Promise<never>(() => {});

describe('cacheAttempt', () => {
  beforeEach(() => resetCacheCircuit());

  it('returns the value when the cache answers', async () => {
    await expect(cacheAttempt(async () => 'hit')).resolves.toBe('hit');
  });

  it('passes a genuine cache miss through as null', async () => {
    await expect(cacheAttempt(async () => null)).resolves.toBeNull();
    expect(cacheCircuitIsOpen()).toBe(false);
  });

  it('returns null instead of hanging forever', async () => {
    const started = Date.now();
    await expect(cacheAttempt(hang, 50)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns null when the operation rejects', async () => {
    await expect(
      cacheAttempt(async () => {
        throw new Error('ECONNREFUSED');
      }),
    ).resolves.toBeNull();
  });

  it('opens the circuit after a timeout so later calls short-circuit', async () => {
    await cacheAttempt(hang, 50);
    expect(cacheCircuitIsOpen()).toBe(true);

    const operation = jest.fn(hang);
    const started = Date.now();
    await expect(cacheAttempt(operation, 5000)).resolves.toBeNull();

    // Skipped entirely — never even calls Redis.
    expect(operation).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('closes the circuit once the cache answers again', async () => {
    await cacheAttempt(hang, 50);
    expect(cacheCircuitIsOpen()).toBe(true);

    resetCacheCircuit(); // stand-in for the cooldown elapsing
    await expect(cacheAttempt(async () => 'back')).resolves.toBe('back');
    expect(cacheCircuitIsOpen()).toBe(false);
  });
});
