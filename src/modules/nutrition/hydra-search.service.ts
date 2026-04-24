import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { FoodItemService } from './food-item.service';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import { UsdaProvider } from './providers/usda.provider';
import { CalorieNinjasProvider } from './providers/calorie-ninjas.provider';
import { NormalizedFood } from './providers/open-food-facts.provider';
import { FoodItemDocument } from '../../database/schemas/nutrition/food-item.schema';
import { normalizeCountry } from '../../utils/countries.util';

interface HydraSearchOpts {
  limit?: number;
  locale?: string;
}

interface ScoredFood extends NormalizedFood {
  _hydraScore: number;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

type ProviderName = 'calorieNinjas' | 'usda' | 'offLocal' | 'offGlobal';

const COUNTRY_NAME_TO_LOCALE: Record<string, string> = {
  India: 'IN',
  'United States': 'US',
  'United Kingdom': 'GB',
  Australia: 'AU',
  Canada: 'CA',
  China: 'CN',
  Japan: 'JP',
  'South Korea': 'KR',
  Singapore: 'SG',
  'United Arab Emirates': 'AE',
  Germany: 'DE',
  France: 'FR',
  'New Zealand': 'NZ',
};

const LOCALE_TO_OFF_COUNTRY_TAG: Record<string, string> = {
  IN: 'india',
  US: 'united-states',
  GB: 'united-kingdom',
  AU: 'australia',
  CA: 'canada',
  CN: 'china',
  JP: 'japan',
  KR: 'south-korea',
  SG: 'singapore',
  AE: 'united-arab-emirates',
  DE: 'germany',
  FR: 'france',
  NZ: 'new-zealand',
};


const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000; 
const PER_PROVIDER_TIMEOUT_MS = 6_000;

const SOURCE_WEIGHT: Record<ProviderName, number> = {
  calorieNinjas: 0.90, 
  usda: 1.0,          
  offLocal: 0.80,     
  offGlobal: 0.70,   
};

const QUERY_EXPANSIONS: Record<string, string> = {
  'pb': 'peanut butter',
  'oj': 'orange juice',
  'chix': 'chicken',
  'bc': 'butter chicken',
  'pbm': 'paneer butter masala',
  'pp': 'palak paneer',
  'dm': 'dal makhani',
  'gc': 'grilled chicken',
};

@Injectable()
export class HydraSearchService {
  private readonly logger = new Logger('HydraSearch');

  private circuits: Record<ProviderName, CircuitState> = {
    calorieNinjas: { failures: 0, lastFailure: 0, state: 'closed' },
    usda: { failures: 0, lastFailure: 0, state: 'closed' },
    offLocal: { failures: 0, lastFailure: 0, state: 'closed' },
    offGlobal: { failures: 0, lastFailure: 0, state: 'closed' },
  };

  constructor(
    private readonly foodItemService: FoodItemService,
    private readonly calorieNinjas: CalorieNinjasProvider,
    private readonly usda: UsdaProvider,
    private readonly openFoodFacts: OpenFoodFactsProvider,
  ) {}

  async search(
    rawQuery: string,
    opts: HydraSearchOpts = {},
  ): Promise<{ count: number; items: FoodItemDocument[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const locale = this.normalizeLocale(opts.locale);

    const q = this.normalize(rawQuery);
    if (!q) {
      const cached = await this.foodItemService.search({ limit });
      return { count: cached.length, items: cached };
    }

    const cached = await this.foodItemService.search({ q, locale, limit: Math.max(limit * 2, limit) });

    const liveResults = await this.fanOut(q, limit, locale);
    this.logger.debug(
      `HydraSearch "${q}": cache=${cached.length}, live providers=${liveResults.length} [${liveResults.map((r) => `${r.provider}:${r.items.length}`).join(', ')}]`,
    );

    const scored = this.scoreAndDedupe(q, liveResults);

    if (scored.length === 0 && cached.length > 0) {
      this.logger.debug(`HydraSearch "${q}": all providers empty, serving ${cached.length} cached items`);
      return { count: cached.length, items: cached.slice(0, limit) };
    }

    const liveKeys = new Set(scored.map((s) => this.dedupeKey(s)));
    for (const doc of cached) {
      const key = this.dedupeKey(doc as any);
      if (liveKeys.has(key)) continue;
      scored.push({
        canonicalName: doc.canonicalName,
        displayName: doc.displayName,
        aliases: doc.aliases ?? [],
        brand: doc.brand ?? null,
        barcode: doc.barcode ?? null,
        category: doc.category,
        servingOptions: doc.servingOptions ?? [],
        per100g: doc.per100g,
        source: doc.source,
        confidence: doc.confidence ?? 0.7,
        verified: doc.verified ?? false,
        locale: doc.locale ?? 'global',
        _hydraScore: 0,
      } as ScoredFood);
      liveKeys.add(key);
    }

    scored.sort((a, b) => b._hydraScore - a._hydraScore);
    const finalItems = scored.slice(0, limit);
    const items = await this.warmCacheAndReturn(finalItems);

    return { count: items.length, items };
  }

  
  private normalize(raw: string): string {
    let q = raw.trim().toLowerCase();

    if (QUERY_EXPANSIONS[q]) q = QUERY_EXPANSIONS[q];

    q = q.replace(/\b(the|a|an|of|with|and|in)\b/g, ' ').replace(/\s+/g, ' ').trim();

    return q;
  }

  
  private async fanOut(
    q: string,
    limit: number,
    locale: string,
  ): Promise<{ provider: ProviderName; items: NormalizedFood[] }[]> {
    type Head = {
      name: ProviderName;
      fn: () => Promise<NormalizedFood[]>;
    };

    const localOffCountryTag = LOCALE_TO_OFF_COUNTRY_TAG[locale];

    const heads: Head[] = [
      {
        name: 'calorieNinjas',
        fn: () => this.calorieNinjas.search(q, { limit }),
      },
      {
        name: 'usda',
        fn: () => this.usda.search(q, { pageSize: limit }),
      },
      {
        name: 'offLocal',
        fn: () =>
          localOffCountryTag
            ? this.openFoodFacts.search(q, { pageSize: limit, country: localOffCountryTag })
            : Promise.resolve([]),
      },
      {
        name: 'offGlobal',
        fn: () => this.openFoodFacts.search(q, { pageSize: Math.ceil(limit / 2) }),
      },
    ];

    const activeHeads = heads.filter((h) => this.shouldAttempt(h.name));

    const settled = await Promise.allSettled(
      activeHeads.map(async (head) => {
        try {
          const items = await this.withTimeout(head.fn(), PER_PROVIDER_TIMEOUT_MS);
          this.recordSuccess(head.name);
          return { provider: head.name, items };
        } catch (err) {
          this.recordFailure(head.name, err as Error);
          return { provider: head.name, items: [] as NormalizedFood[] };
        }
      }),
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<{ provider: ProviderName; items: NormalizedFood[] }> =>
        r.status === 'fulfilled',
      )
      .map((r) => r.value);
  }

  private scoreAndDedupe(
    query: string,
    providerResults: { provider: ProviderName; items: NormalizedFood[] }[],
  ): ScoredFood[] {
    const buckets: ScoredFood[][] = [];

    for (const { provider, items } of providerResults) {
      if (items.length === 0) continue;
      const scored: ScoredFood[] = items.map((item) => ({
        ...item,
        _hydraScore: this.computeScore(query, item, provider),
      }));
      scored.sort((a, b) => b._hydraScore - a._hydraScore);
      buckets.push(scored);
    }

    buckets.sort(
      (a, b) => (b[0]?._hydraScore ?? 0) - (a[0]?._hydraScore ?? 0),
    );

 
    const interleaved: ScoredFood[] = [];
    const cursors = buckets.map(() => 0);
    let active = true;

    while (active) {
      active = false;
      for (let b = 0; b < buckets.length; b++) {
        if (cursors[b] < buckets[b].length) {
          interleaved.push(buckets[b][cursors[b]]);
          cursors[b]++;
          active = true;
        }
      }
    }

    const deduped: ScoredFood[] = [];
    const seenKeys = new Set<string>();
    const acceptedTokenSets: { brand: string; tokens: Set<string> }[] = [];

    for (const item of interleaved) {
      const key = this.dedupeKey(item);
      if (seenKeys.has(key)) continue;

      const cTokens = item.canonicalName.split(/\s+/).filter(Boolean);
      if (cTokens.length > 0) {
        const brand = item.brand ?? '';
        let isDup = false;
        for (const acc of acceptedTokenSets) {
          if (brand !== acc.brand) continue;
          const overlap = cTokens.filter((t) => acc.tokens.has(t)).length;
          const ratio = overlap / Math.max(cTokens.length, acc.tokens.size);
          if (ratio >= 0.8) { isDup = true; break; }
        }
        if (isDup) continue;
        acceptedTokenSets.push({ brand, tokens: new Set(cTokens) });
      }

      seenKeys.add(key);
      deduped.push(item);
    }

    return deduped;
  }

  private computeScore(
    query: string,
    item: NormalizedFood,
    provider: ProviderName,
  ): number {
    let score = 0;

    score += (SOURCE_WEIGHT[provider] ?? 0.5) * 30;

    const name = item.canonicalName;
    if (name === query) {
      score += 40; 
    } else if (name.startsWith(query)) {
      score += 30;
    } else if (name.includes(query)) {
      score += 20;
    } else {
      const qt = new Set(query.split(/\s+/));
      const nt = name.split(/\s+/);
      const overlap = nt.filter((t) => qt.has(t)).length;
      score += Math.min(overlap * 8, 20);
    }

    const n = item.per100g;
    const filled = [n.kcal, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g, n.sugar_g, n.sodium_mg]
      .filter((v) => v > 0).length;
    score += (filled / 7) * 15;

    if (item.verified) score += 10;

    score += (item.confidence ?? 0) * 5;

    return Math.round(score * 100) / 100;
  }

  private dedupeKey(item: NormalizedFood): string {
    if (item.barcode) {
      return `bc:${item.barcode}`;
    }

    // Source-agnostic dedupe: same product name + brand + locale = same product
    // regardless of whether it came from AI, OFF, USDA, etc.
    return [
      item.canonicalName.replace(/\s+/g, ' '),
      (item.brand ?? '').toLowerCase().trim(),
      item.locale ?? 'global',
    ].join('|');
  }

  private async warmCacheAndReturn(scored: ScoredFood[]): Promise<FoodItemDocument[]> {
    const normalized = scored.map((item) => {
      const { _hydraScore, ...rest } = item;
      return { ...rest, isPublic: true };
    });

    try {
      const docs = await this.foodItemService.bulkUpsert(normalized);
      return this.mapScoredItemsToDocs(scored, docs);
    } catch (err) {
      this.logger.warn(`Bulk cache warm failed: ${(err as Error).message}`);

      const docs: FoodItemDocument[] = [];
      for (const item of normalized) {
        try {
          const doc = await this.foodItemService.upsert(item);
          docs.push(doc);
        } catch (upsertErr) {
          this.logger.warn(
            `Single-item cache warm failed for ${item.displayName}: ${(upsertErr as Error).message}`,
          );

          if (item.barcode) {
            const existing = await this.foodItemService.findByBarcode(item.barcode);
            if (existing) {
              docs.push(existing);
            }
          }
        }
      }

      return this.mapScoredItemsToDocs(scored, docs);
    }
  }

  private mapScoredItemsToDocs(
    scored: ScoredFood[],
    docs: FoodItemDocument[],
  ): FoodItemDocument[] {
    const docMap = new Map<string, FoodItemDocument>();
    for (const doc of docs) {
      const key = [
        (doc.canonicalName ?? '').toLowerCase(),
        (doc.brand ?? '').toLowerCase().trim(),
        doc.locale ?? 'global',
        doc.source ?? 'unknown',
      ].join('|');
      docMap.set(key, doc);
      if (doc.barcode) docMap.set(`bc:${doc.barcode}`, doc);
    }

    return scored.map((item) => {
      if (item.barcode) {
        const found = docMap.get(`bc:${item.barcode}`);
        if (found) return found;
      }
      const key = [
        item.canonicalName.toLowerCase(),
        (item.brand ?? '').toLowerCase().trim(),
        item.locale ?? 'global',
        item.source ?? 'unknown',
      ].join('|');
      return docMap.get(key) ?? this.toDocument(item);
    });
  }

  private toDocument(item: ScoredFood): FoodItemDocument {
    const { _hydraScore, ...rest } = item;
    return {
      _id: this.syntheticId(item),
      ...rest,
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  }

  private syntheticId(_item: NormalizedFood): string {
    return `synthetic-${Math.random().toString(36).slice(2, 10)}`;
  }

  private shouldAttempt(name: ProviderName): boolean {
    const c = this.circuits[name];
    if (c.state === 'closed') return true;

    const elapsed = Date.now() - c.lastFailure;
    if (elapsed >= CIRCUIT_COOLDOWN_MS) {
      c.state = 'half-open';
      this.logger.log(`Circuit ${name}: OPEN → HALF-OPEN (cooldown elapsed)`);
      return true;
    }

    return false;
  }

  private normalizeLocale(locale?: string): string {
    if (!locale) return 'global';

    const trimmed = locale.trim();
    if (!trimmed) return 'global';
    if (trimmed.toLowerCase() === 'global') return 'global';

    if (/^[A-Za-z]{2}$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    const normalizedCountry = normalizeCountry(trimmed);
    return normalizedCountry ? COUNTRY_NAME_TO_LOCALE[normalizedCountry] ?? 'global' : 'global';
  }

  private recordSuccess(name: ProviderName): void {
    const c = this.circuits[name];
    if (c.state !== 'closed') {
      this.logger.log(`Circuit ${name}: ${c.state} → CLOSED (success)`);
    }
    c.failures = 0;
    c.state = 'closed';
  }

  private recordFailure(name: ProviderName, err: Error): void {
    const c = this.circuits[name];
    c.failures++;
    c.lastFailure = Date.now();

    if (c.state === 'half-open' || c.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      c.state = 'open';
      this.logger.warn(
        `Circuit ${name}: → OPEN after ${c.failures} failures (${err.message}). ` +
          `Cooling down ${CIRCUIT_COOLDOWN_MS / 1000}s.`,
      );
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
      promise
        .then((val) => { clearTimeout(timer); resolve(val); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }
}
