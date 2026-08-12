import { AiImpactService } from './ai-impact.service';
import { CO2E_KG_PER_KG_FALLBACK } from './utils/ai-impact.util';

/** In-memory stand-in for RedisService with just the surface this service uses. */
class FakeRedis {
  store = new Map<string, any>();
  getCalls: string[] = [];
  setCalls: Array<{ key: string; value: any }> = [];
  failReads = false;

  async get<T>(key: string): Promise<T | null> {
    this.getCalls.push(key);
    if (this.failReads) throw new Error('redis down');
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  async set(key: string, value: any) {
    this.setCalls.push({ key, value });
    this.store.set(key, value);
  }
}

/** AU survey rate: 0.004/g => flat reference of A$4/kg. */
const AU_RATES = [
  { countryCode: 'AU', countryName: 'Australia', costPerGram: 0.004, isActive: true },
];

function makeService(aiResponses: string[] | Error) {
  const redis = new FakeRedis();
  const service = new AiImpactService(redis as any);
  const callAi = jest.fn().mockImplementation(() => {
    if (aiResponses instanceof Error) return Promise.reject(aiResponses);
    const next = (aiResponses as string[]).shift();
    if (next === undefined) return Promise.reject(new Error('no stub left'));
    return Promise.resolve(next);
  });
  (service as any).callAi = callAi;
  return { service, redis, callAi };
}

/** Silence the Nest logger so expected-failure paths do not spam the run. */
beforeAll(() => {
  jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => jest.restoreAllMocks());

describe('AiImpactService', () => {
  describe('resolveBatch — happy path', () => {
    it('prices each ingredient from its own AI rates in ONE call', async () => {
      const { service, callAi } = makeService([
        JSON.stringify({
          r: [
            { i: 1, p: 25, c: 60 }, // beef: A$25/kg, 60 kg CO2e/kg
            { i: 2, p: 3, c: 0.4 }, // potato: A$3/kg, 0.4 kg CO2e/kg
          ],
        }),
      ]);

      const out = await service.resolveBatch(
        [
          { name: 'beef mince', weightGrams: 500 },
          { name: 'potato', weightGrams: 500 },
        ],
        'Australia',
        AU_RATES,
      );

      expect(callAi).toHaveBeenCalledTimes(1);

      // 0.5 kg x 25 = 12.50 ; 500 g x 60 = 30000 g CO2e
      expect(out[0]).toMatchObject({
        ingredient: 'beef mince',
        weightInGrams: 500,
        priceInLocalCurrency: 12.5,
        co2SavedInGrams: 30000,
        source: 'ai',
      });
      // 0.5 kg x 3 = 1.50 ; 500 g x 0.4 = 200 g CO2e
      expect(out[1]).toMatchObject({
        priceInLocalCurrency: 1.5,
        co2SavedInGrams: 200,
        source: 'ai',
      });

      // The whole point of the change: same weight, very different impact.
      expect(out[0].co2SavedInGrams).toBeGreaterThan(out[1].co2SavedInGrams * 100);
    });

    it('resolves free-form quantities to grams', async () => {
      const { service } = makeService([
        JSON.stringify({ r: [{ i: 1, g: 220, p: 3, c: 0.4 }] }),
      ]);

      const [onion] = await service.resolveBatch(
        [{ name: 'onion', quantity: '2 large' }],
        'Australia',
        AU_RATES,
      );

      expect(onion.weightInGrams).toBe(220);
      expect(onion.priceInLocalCurrency).toBe(0.66); // 0.22 kg x 3
      expect(onion.co2SavedInGrams).toBe(88); // 220 g x 0.4
    });

    it('returns one entry per input, in input order', async () => {
      const { service } = makeService([
        JSON.stringify({
          r: [
            { i: 1, p: 5, c: 1 },
            { i: 2, p: 5, c: 1 },
            { i: 3, p: 5, c: 1 },
          ],
        }),
      ]);

      const out = await service.resolveBatch(
        [
          { name: 'a', weightGrams: 100 },
          { name: 'b', weightGrams: 100 },
          { name: 'c', weightGrams: 100 },
        ],
        'Australia',
        AU_RATES,
      );

      expect(out.map((r) => r.ingredient)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('caching', () => {
    it('serves a second cook of the same ingredient without calling the AI', async () => {
      const { service, callAi, redis } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 25, c: 60 }] }),
      ]);

      const first = await service.resolveBatch(
        [{ name: 'beef mince', weightGrams: 500 }],
        'Australia',
        AU_RATES,
      );
      expect(first[0].source).toBe('ai');

      // Let the fire-and-forget cache writes settle.
      await new Promise((r) => setImmediate(r));

      const second = await service.resolveBatch(
        [{ name: 'Beef  Mince', weightGrams: 200 }], // different case/spacing + weight
        'Australia',
        AU_RATES,
      );

      expect(callAi).toHaveBeenCalledTimes(1);
      expect(second[0].source).toBe('cache');
      // Cached RATES re-apply to a different weight: 0.2 kg x 25 = 5.00
      expect(second[0].priceInLocalCurrency).toBe(5);
      expect(second[0].co2SavedInGrams).toBe(12000);
      expect(redis.setCalls.some((c) => c.key.includes('impact:rate:v3'))).toBe(true);
    });

    it('keys rates by country so prices do not leak across markets', async () => {
      const { service, callAi } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 25, c: 60 }] }),
        JSON.stringify({ r: [{ i: 1, p: 900, c: 60 }] }),
      ]);

      await service.resolveBatch(
        [{ name: 'beef', weightGrams: 1000 }],
        'Australia',
        AU_RATES,
      );
      await new Promise((r) => setImmediate(r));

      const india = await service.resolveBatch(
        [{ name: 'beef', weightGrams: 1000 }],
        'India',
        null,
      );

      expect(callAi).toHaveBeenCalledTimes(2);
      expect(india[0].priceInLocalCurrency).toBe(900);
    });

    it('survives a Redis outage by falling through to the AI', async () => {
      const { service, redis } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 25, c: 60 }] }),
      ]);
      redis.failReads = true;

      const [row] = await service.resolveBatch(
        [{ name: 'beef', weightGrams: 100 }],
        'Australia',
        AU_RATES,
      );

      expect(row.source).toBe('ai');
      expect(row.priceInLocalCurrency).toBe(2.5);
    });
  });

  describe('fallbacks', () => {
    it('uses flat country rates when the AI call fails', async () => {
      const { service } = makeService(new Error('timeout'));

      const [row] = await service.resolveBatch(
        [{ name: 'beef', weightGrams: 1000 }],
        'Australia',
        AU_RATES,
      );

      expect(row.source).toBe('fallback');
      expect(row.priceInLocalCurrency).toBe(4); // 1 kg x A$4/kg flat
      expect(row.co2SavedInGrams).toBe(1000 * CO2E_KG_PER_KG_FALLBACK);
    });

    it('falls back per-ingredient when the AI answers only some rows', async () => {
      const { service } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 25, c: 60 }] }), // row 2 missing
      ]);

      const out = await service.resolveBatch(
        [
          { name: 'beef', weightGrams: 1000 },
          { name: 'mystery', weightGrams: 1000 },
        ],
        'Australia',
        AU_RATES,
      );

      expect(out[0]).toMatchObject({ source: 'ai', priceInLocalCurrency: 25 });
      expect(out[1]).toMatchObject({ source: 'fallback', priceInLocalCurrency: 4 });
    });

    it('rejects an implausible AI price and uses the flat rate instead', async () => {
      const { service } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 999999999, c: 60 }] }),
      ]);

      const [row] = await service.resolveBatch(
        [{ name: 'beef', weightGrams: 1000 }],
        'Australia',
        AU_RATES,
      );

      // Price failed its clamp, so the whole rate pair is discarded.
      expect(row.source).toBe('fallback');
      expect(row.priceInLocalCurrency).toBe(4);
      expect(row.co2SavedInGrams).toBe(2100);
    });

    it('handles malformed AI JSON', async () => {
      const { service } = makeService(['<html>gateway error</html>']);

      const [row] = await service.resolveBatch(
        [{ name: 'beef', weightGrams: 1000 }],
        'Australia',
        AU_RATES,
      );
      expect(row.source).toBe('fallback');
    });

    it('prices an unknown country off the fallback $/kg table', async () => {
      const { service } = makeService(new Error('down'));

      const [row] = await service.resolveBatch(
        [{ name: 'rice', weightGrams: 2000 }],
        'Atlantis',
        null,
      );
      expect(row.priceInLocalCurrency).toBe(10); // 2 kg x $5/kg default
    });
  });

  describe('token thrift', () => {
    it('never calls the AI for negligible quantities', async () => {
      const { service, callAi } = makeService([]);

      const out = await service.resolveBatch(
        [
          { name: 'salt', quantity: 'to taste' },
          { name: 'parsley', quantity: 'for garnish' },
        ],
        'Australia',
        AU_RATES,
      );

      expect(callAi).not.toHaveBeenCalled();
      expect(out.every((r) => r.weightInGrams === 0)).toBe(true);
      expect(out.every((r) => r.priceInLocalCurrency === 0)).toBe(true);
      expect(out.every((r) => r.co2SavedInGrams === 0)).toBe(true);
    });

    it('never calls the AI for zero-weight items', async () => {
      const { service, callAi } = makeService([]);

      const out = await service.resolveBatch(
        [{ name: 'water', weightGrams: 0 }],
        'Australia',
        AU_RATES,
      );

      expect(callAi).not.toHaveBeenCalled();
      expect(out[0].priceInLocalCurrency).toBe(0);
    });

    it('splits oversized ingredient lists into parallel chunks', async () => {
      const rows = (count: number, offset: number) =>
        JSON.stringify({
          r: Array.from({ length: count }, (_, i) => ({
            i: i + 1,
            p: 10,
            c: 1,
            _debug: offset,
          })),
        });
      const { service, callAi } = makeService([rows(25, 0), rows(5, 25)]);

      const items = Array.from({ length: 30 }, (_, i) => ({
        name: `ing-${i}`,
        weightGrams: 100,
      }));
      const out = await service.resolveBatch(items, 'Australia', AU_RATES);

      expect(callAi).toHaveBeenCalledTimes(2);
      expect(out).toHaveLength(30);
      expect(out.every((r) => r.source === 'ai')).toBe(true);
      expect(out.every((r) => r.priceInLocalCurrency === 1)).toBe(true);
    });

    it('only asks the AI about the ingredients it does not already know', async () => {
      const { service, callAi } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 25, c: 60 }] }),
        JSON.stringify({ r: [{ i: 1, p: 3, c: 0.4 }] }),
      ]);

      await service.resolveBatch(
        [{ name: 'beef', weightGrams: 100 }],
        'Australia',
        AU_RATES,
      );
      await new Promise((r) => setImmediate(r));

      await service.resolveBatch(
        [
          { name: 'beef', weightGrams: 100 },
          { name: 'potato', weightGrams: 100 },
        ],
        'Australia',
        AU_RATES,
      );

      // Second call carried only the uncached ingredient.
      const secondPrompt = callAi.mock.calls[1][0][1].content as string;
      expect(secondPrompt).toContain('potato');
      expect(secondPrompt).not.toContain('beef');
    });
  });

  describe('edge cases', () => {
    it('returns an empty array for no items', async () => {
      const { service, callAi } = makeService([]);
      expect(await service.resolveBatch([], 'Australia', AU_RATES)).toEqual([]);
      expect(callAi).not.toHaveBeenCalled();
    });

    it('tolerates a blank ingredient name', async () => {
      const { service, callAi } = makeService([]);
      const out = await service.resolveBatch(
        [{ name: '   ', weightGrams: 100 }],
        'Australia',
        AU_RATES,
      );
      expect(callAi).not.toHaveBeenCalled();
      expect(out[0]).toMatchObject({
        weightInGrams: 0,
        priceInLocalCurrency: 0,
        co2SavedInGrams: 0,
      });
    });

    it('keeps the caller weight when a quantity cannot be resolved', async () => {
      const { service } = makeService([
        JSON.stringify({ r: [{ i: 1, p: 3, c: 0.4 }] }), // no g returned
      ]);

      const [row] = await service.resolveBatch(
        [{ name: 'onion', quantity: '2 large', weightGrams: 150 }],
        'Australia',
        AU_RATES,
      );
      expect(row.weightInGrams).toBe(150);
    });
  });
});
