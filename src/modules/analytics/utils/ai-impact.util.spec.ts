import {
  CO2E_KG_PER_KG_FALLBACK,
  CO2E_MAX_KG_PER_KG,
  MAX_ITEMS_PER_AI_CALL,
  PRICE_MAX_MULTIPLE,
  buildImpactMessages,
  chunkItems,
  clampCo2eKgPerKg,
  clampPricePerKg,
  clampWeightGrams,
  impactFromRates,
  isNegligibleQuantity,
  normalizeIngredientKey,
  normalizeQuantityKey,
  parseImpactResponse,
} from './ai-impact.util';

describe('ai-impact.util', () => {
  describe('normalizeIngredientKey', () => {
    it('collapses case and whitespace so variants share a cache entry', () => {
      expect(normalizeIngredientKey('  Large   Onion ')).toBe('large onion');
      expect(normalizeIngredientKey('LARGE ONION')).toBe(
        normalizeIngredientKey('large onion'),
      );
    });

    it('is safe on empty input', () => {
      expect(normalizeIngredientKey('')).toBe('');
      expect(normalizeIngredientKey(undefined as any)).toBe('');
    });

    it('caps length to keep Redis keys bounded', () => {
      expect(normalizeIngredientKey('a'.repeat(200))).toHaveLength(80);
    });
  });

  describe('normalizeQuantityKey', () => {
    it('normalizes case and spacing', () => {
      expect(normalizeQuantityKey(' 2  Large ')).toBe('2 large');
    });
  });

  describe('isNegligibleQuantity', () => {
    it.each(['to taste', 'To Taste', 'a pinch', 'for garnish', 'as needed'])(
      'treats %s as negligible',
      (qty) => {
        expect(isNegligibleQuantity(qty)).toBe(true);
      },
    );

    it.each(['2 large', '1 cup', '500g', ''])(
      'treats %s as a real quantity',
      (qty) => {
        expect(isNegligibleQuantity(qty)).toBe(false);
      },
    );

    it('handles null/undefined', () => {
      expect(isNegligibleQuantity(null)).toBe(false);
      expect(isNegligibleQuantity(undefined)).toBe(false);
    });
  });

  describe('clampCo2eKgPerKg', () => {
    it('accepts realistic factors', () => {
      expect(clampCo2eKgPerKg(60)).toBe(60);
      expect(clampCo2eKgPerKg(0.4)).toBe(0.4); 
      expect(clampCo2eKgPerKg('2.7')).toBe(2.7);
    });

    it('rejects values outside the plausible band', () => {
      expect(clampCo2eKgPerKg(CO2E_MAX_KG_PER_KG + 1)).toBeNull();
      expect(clampCo2eKgPerKg(0.001)).toBeNull();
    });

    it('rejects junk', () => {
      expect(clampCo2eKgPerKg(0)).toBeNull();
      expect(clampCo2eKgPerKg(-5)).toBeNull();
      expect(clampCo2eKgPerKg(null)).toBeNull();
      expect(clampCo2eKgPerKg('abc')).toBeNull();
      expect(clampCo2eKgPerKg(Infinity)).toBeNull();
      expect(clampCo2eKgPerKg(NaN)).toBeNull();
    });
  });

  describe('clampPricePerKg', () => {
    const flat = 15; // ₹15/kg reference

    it('accepts prices within the sanity band', () => {
      expect(clampPricePerKg(40, flat)).toBe(40);
      expect(clampPricePerKg(3000, flat)).toBe(3000); 
    });

    it('rejects a catastrophic hallucination', () => {
      expect(clampPricePerKg(flat * PRICE_MAX_MULTIPLE * 10, flat)).toBeNull();
      expect(clampPricePerKg(1e12, flat)).toBeNull();
    });

    it('rejects non-positive and non-finite values', () => {
      expect(clampPricePerKg(0, flat)).toBeNull();
      expect(clampPricePerKg(-3, flat)).toBeNull();
      expect(clampPricePerKg(Infinity, flat)).toBeNull();
      expect(clampPricePerKg('x', flat)).toBeNull();
    });

    it('falls back to a bare positivity check when no flat reference exists', () => {
      expect(clampPricePerKg(999999, 0)).toBe(999999);
      expect(clampPricePerKg(-1, 0)).toBeNull();
    });
  });

  describe('clampWeightGrams', () => {
    it('accepts realistic weights including zero', () => {
      expect(clampWeightGrams(0)).toBe(0);
      expect(clampWeightGrams(250.44)).toBe(250.4);
    });

    it('rejects negatives and absurd weights', () => {
      expect(clampWeightGrams(-1)).toBeNull();
      expect(clampWeightGrams(50_001)).toBeNull();
      expect(clampWeightGrams('nope')).toBeNull();
    });

    it('distinguishes an absent value from a real zero', () => {
      // Number(null) is 0, so without an explicit guard a cache miss would be
      // read as a genuine zero-weight ingredient and skip AI resolution.
      expect(clampWeightGrams(null)).toBeNull();
      expect(clampWeightGrams(undefined)).toBeNull();
      expect(clampWeightGrams('')).toBeNull();
      expect(clampWeightGrams(0)).toBe(0);
    });
  });

  describe('impactFromRates', () => {
    it('applies per-kg rates to an actual weight', () => {
      // 500 g of beef at ₹700/kg and 60 kg CO2e/kg
      expect(impactFromRates(500, { pricePerKg: 700, co2eKgPerKg: 60 })).toEqual({
        priceInLocalCurrency: 350,
        co2SavedInGrams: 30000,
      });
    });

    it('matches the flat platform factor when given it', () => {
      const { co2SavedInGrams } = impactFromRates(3000, {
        pricePerKg: 10,
        co2eKgPerKg: CO2E_KG_PER_KG_FALLBACK,
      });
      // Same answer the old flat formula produced: 3000 g x 2.1
      expect(co2SavedInGrams).toBe(6300);
    });

    it('rounds money to 2dp and CO2 to whole grams', () => {
      const r = impactFromRates(333, { pricePerKg: 7.77, co2eKgPerKg: 1.234 });
      expect(r.priceInLocalCurrency).toBe(2.59);
      expect(r.co2SavedInGrams).toBe(411);
    });

    it('is zero-safe and negative-safe', () => {
      expect(impactFromRates(0, { pricePerKg: 100, co2eKgPerKg: 5 })).toEqual({
        priceInLocalCurrency: 0,
        co2SavedInGrams: 0,
      });
      expect(impactFromRates(-50, { pricePerKg: 100, co2eKgPerKg: 5 })).toEqual({
        priceInLocalCurrency: 0,
        co2SavedInGrams: 0,
      });
    });
  });

  describe('buildImpactMessages', () => {
    const items = [
      { name: 'onion', quantity: '2 large' },
      { name: 'saffron', quantity: 'a pinch' },
      { name: 'basmati rice', weightGrams: 300 },
    ];

    it('emits a system + user pair', () => {
      const msgs = buildImpactMessages(items, 'India');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].role).toBe('user');
    });

    it('anchors the model on CO2e reference values', () => {
      const [system] = buildImpactMessages(items, 'India');
      expect(system.content).toContain('beef 60');
      expect(system.content).toContain('vegetables 0.5');
    });

    it('numbers items and echoes the country', () => {
      const [, user] = buildImpactMessages(items, 'India');
      expect(user.content).toContain('country: India');
      expect(user.content).toContain('1. onion | 2 large');
      expect(user.content).toContain('2. saffron | a pinch');
      // No quantity supplied -> no pipe separator
      expect(user.content).toContain('3. basmati rice');
      expect(user.content).not.toContain('3. basmati rice |');
      expect(user.content).toContain('3 entries total');
    });

    it('asks for the weight field only when some item needs a weight', () => {
      const [, withQty] = buildImpactMessages(items, 'India');
      expect(withQty.content).toContain('"g":0');

      const [, withoutQty] = buildImpactMessages(
        [{ name: 'rice', weightGrams: 100 }],
        'India',
      );
      expect(withoutQty.content).not.toContain('"g":0');
    });

    it('batches the whole recipe into one request', () => {
      const many = Array.from({ length: 20 }, (_, i) => ({ name: `ing-${i}` }));
      const msgs = buildImpactMessages(many, 'Australia');
      expect(msgs).toHaveLength(2);
      expect(msgs[1].content).toContain('20. ing-19');
    });
  });

  describe('parseImpactResponse', () => {
    const flat = 15;

    it('parses the documented {"r":[...]} shape', () => {
      const content = JSON.stringify({
        r: [
          { i: 1, g: 220, p: 40, c: 0.5 },
          { i: 2, g: 0.5, p: 3000, c: 11 },
        ],
      });
      const parsed = parseImpactResponse(content, 2, flat);

      expect(parsed.get(1)).toEqual({
        index: 1,
        weightGrams: 220,
        pricePerKg: 40,
        co2eKgPerKg: 0.5,
      });
      expect(parsed.get(2)?.pricePerKg).toBe(3000);
    });

    it('accepts a bare array and long-form keys', () => {
      const content = JSON.stringify([
        { index: 1, weightInGrams: 100, pricePerKg: 20, co2eKgPerKg: 1 },
      ]);
      expect(parseImpactResponse(content, 1, flat).get(1)?.pricePerKg).toBe(20);
    });

    it('falls back to array position when the index is missing', () => {
      const content = JSON.stringify({ r: [{ g: 100, p: 20, c: 1 }] });
      expect(parseImpactResponse(content, 1, flat).get(1)?.weightGrams).toBe(100);
    });

    it('drops implausible numbers but keeps the usable fields of that row', () => {
      const content = JSON.stringify({
        r: [{ i: 1, g: 100, p: 1e12, c: 500 }],
      });
      const row = parseImpactResponse(content, 1, flat).get(1);
      expect(row?.weightGrams).toBe(100);
      expect(row?.pricePerKg).toBeNull();
      expect(row?.co2eKgPerKg).toBeNull();
    });

    it('ignores rows addressing items outside the request', () => {
      const content = JSON.stringify({
        r: [
          { i: 1, g: 10, p: 20, c: 1 },
          { i: 99, g: 10, p: 20, c: 1 },
        ],
      });
      const parsed = parseImpactResponse(content, 1, flat);
      expect(parsed.size).toBe(1);
      expect(parsed.has(99)).toBe(false);
    });

    it('returns empty on malformed JSON or unexpected shapes', () => {
      expect(parseImpactResponse('not json', 2, flat).size).toBe(0);
      expect(parseImpactResponse('{"nope":true}', 2, flat).size).toBe(0);
      expect(parseImpactResponse('null', 2, flat).size).toBe(0);
    });
  });

  describe('chunkItems', () => {
    it('keeps a normal recipe in a single chunk', () => {
      const items = Array.from({ length: MAX_ITEMS_PER_AI_CALL }, (_, i) => i);
      expect(chunkItems(items)).toHaveLength(1);
    });

    it('splits oversized lists', () => {
      const items = Array.from({ length: 60 }, (_, i) => i);
      const chunks = chunkItems(items, 25);
      expect(chunks.map((c) => c.length)).toEqual([25, 25, 10]);
    });

    it('handles an empty list', () => {
      expect(chunkItems([])).toEqual([]);
    });
  });
});
