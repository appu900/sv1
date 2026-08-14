import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { RedisService } from 'src/redis/redis.service';
import { fallbackPriceInLocalCurrency } from './utils/fallback-pricing.util';
import {
  CountryRateLike,
  resolveCostPerGram,
} from './utils/impact-pricing.util';
import {
  CO2E_KG_PER_KG_FALLBACK,
  ImpactRates,
  ImpactRequestItem,
  ResolvedImpact,
  buildImpactMessages,
  chunkItems,
  clampWeightGrams,
  impactFromRates,
  isNegligibleQuantity,
  normalizeIngredientKey,
  normalizeQuantityKey,
  parseImpactResponse,
} from './utils/ai-impact.util';

interface CachedRates {
  p: number;
  c: number;
}

@Injectable()
export class AiImpactService {
  private readonly logger = new Logger(AiImpactService.name);
  private openaiClient: OpenAI | null = null;

  private readonly AI_TIMEOUT_MS = 6000;
  private readonly AI_MAX_ATTEMPTS = 2;
  private readonly RATE_CACHE_TTL_SEC = 30 * 24 * 3600;
  private readonly WEIGHT_CACHE_TTL_SEC = 30 * 24 * 3600;
  private readonly AI_MODEL = 'gpt-4.1';

  constructor(private readonly redisService: RedisService) {}

  private getOpenAi(): OpenAI | null {
    if (this.openaiClient) return this.openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    this.openaiClient = new OpenAI({ apiKey });
    return this.openaiClient;
  }

  private rateCacheKey(nameKey: string, country: string): string {
    return `analytics:impact:rate:v3:${country}:${nameKey}`;
  }

  private weightCacheKey(nameKey: string, quantityKey: string): string {
    return `analytics:impact:qty:v3:${nameKey}|${quantityKey}`;
  }


  private flatPricePerKg(
    country: string,
    countryRates?: CountryRateLike[] | null,
  ): number {
    const costPerGram = resolveCostPerGram(country, countryRates);
    if (costPerGram != null && costPerGram > 0) return costPerGram * 1000;
    return fallbackPriceInLocalCurrency(1000, country);
  }

  async resolveBatch(
    items: ImpactRequestItem[],
    country: string,
    countryRates?: CountryRateLike[] | null,
  ): Promise<ResolvedImpact[]> {
    const flatPerKg = this.flatPricePerKg(country, countryRates);
    const fallbackRates: ImpactRates = {
      pricePerKg: flatPerKg,
      co2eKgPerKg: CO2E_KG_PER_KG_FALLBACK,
    };

    if (!items.length) return [];

    const prepared = items.map((item) => {
      const name = (item.name || '').trim();
      const quantity = item.quantity?.trim() || '';
      const negligible = isNegligibleQuantity(quantity);
      return {
        name,
        nameKey: normalizeIngredientKey(name),
        quantity,
        quantityKey: quantity ? normalizeQuantityKey(quantity) : '',
        negligible,
        knownWeight: negligible ? 0 : Math.max(0, Number(item.weightGrams) || 0),
        needsWeight: !negligible && quantity.length > 0,
      };
    });

    const [cachedRates, cachedWeights] = await Promise.all([
      Promise.all(
        prepared.map((p) =>
          p.name ? this.readRates(p.nameKey, country) : Promise.resolve(null),
        ),
      ),
      Promise.all(
        prepared.map((p) =>
          p.needsWeight
            ? this.readWeight(p.nameKey, p.quantityKey)
            : Promise.resolve(null),
        ),
      ),
    ]);

    const pendingIndexes: number[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      if (!p.name || p.negligible) continue;
      const weightKnown = p.needsWeight ? cachedWeights[i] != null : true;
      const effectiveWeight = p.needsWeight ? cachedWeights[i] : p.knownWeight;
      if (weightKnown && (effectiveWeight ?? 0) <= 0) continue;

      const needsRates = cachedRates[i] == null;
      const needsWeightFromAi = p.needsWeight && cachedWeights[i] == null;
      if (needsRates || needsWeightFromAi) pendingIndexes.push(i);
    }

    const aiRows = pendingIndexes.length
      ? await this.resolvePending(
          pendingIndexes.map((i) => ({
            name: prepared[i].name,
            quantity: prepared[i].needsWeight ? prepared[i].quantity : undefined,
          })),
          country,
          flatPerKg,
        )
      : new Map<number, { weightGrams: number | null; rates: ImpactRates | null }>();

    const aiPositionByIndex = new Map<number, number>(
      pendingIndexes.map((itemIndex, position) => [itemIndex, position + 1]),
    );

    const cacheWrites: Promise<void>[] = [];
    const results: ResolvedImpact[] = [];

    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      if (!p.name) {
        results.push({
          ingredient: '',
          weightInGrams: 0,
          priceInLocalCurrency: 0,
          co2SavedInGrams: 0,
          source: 'fallback',
        });
        continue;
      }

      const aiPosition = aiPositionByIndex.get(i);
      const fromAi = aiPosition != null ? aiRows.get(aiPosition) : undefined;

      let weightInGrams: number;
      if (p.negligible) {
        weightInGrams = 0;
      } else if (p.needsWeight) {
        const resolved = cachedWeights[i] ?? fromAi?.weightGrams ?? null;
        weightInGrams = resolved ?? p.knownWeight;
        if (cachedWeights[i] == null && fromAi?.weightGrams != null) {
          cacheWrites.push(
            this.writeWeight(p.nameKey, p.quantityKey, fromAi.weightGrams),
          );
        }
      } else {
        weightInGrams = p.knownWeight;
      }

      const cached = cachedRates[i];
      const aiRates = fromAi?.rates ?? null;
      const rates = cached ?? aiRates ?? fallbackRates;
      if (cached == null && aiRates != null) {
        cacheWrites.push(this.writeRates(p.nameKey, country, aiRates));
      }

      const source: ResolvedImpact['source'] =
        cached != null ? 'cache' : aiRates != null ? 'ai' : 'fallback';

      const impact = impactFromRates(weightInGrams, rates);
      results.push({
        ingredient: p.name,
        weightInGrams: Number(weightInGrams.toFixed(1)),
        priceInLocalCurrency: impact.priceInLocalCurrency,
        co2SavedInGrams: impact.co2SavedInGrams,
        source,
      });
    }

    void Promise.all(cacheWrites).catch(() => undefined);

    return results;
  }
  private async resolvePending(
    pending: ImpactRequestItem[],
    country: string,
    flatPerKg: number,
  ): Promise<
    Map<number, { weightGrams: number | null; rates: ImpactRates | null }>
  > {
    const merged = new Map<
      number,
      { weightGrams: number | null; rates: ImpactRates | null }
    >();

    const chunks = chunkItems(pending);
    const offsets: number[] = [];
    let running = 0;
    for (const chunk of chunks) {
      offsets.push(running);
      running += chunk.length;
    }

    const settled = await Promise.all(
      chunks.map((chunk) => this.resolveChunk(chunk, country, flatPerKg)),
    );

    settled.forEach((rows, chunkIdx) => {
      const offset = offsets[chunkIdx];
      rows.forEach((row, localIndex) => {
        merged.set(offset + localIndex, row);
      });
    });

    return merged;
  }

  private async resolveChunk(
    chunk: ImpactRequestItem[],
    country: string,
    flatPerKg: number,
  ): Promise<
    Map<number, { weightGrams: number | null; rates: ImpactRates | null }>
  > {
    const out = new Map<
      number,
      { weightGrams: number | null; rates: ImpactRates | null }
    >();

    let content: string;
    try {
      content = await this.callAi(buildImpactMessages(chunk, country));
    } catch (err: any) {
      this.logger.warn(
        `impact AI failed for ${chunk.length} item(s) in ${country}: ${err?.message} — using flat rates`,
      );
      return out;
    }

    const parsed = parseImpactResponse(content, chunk.length, flatPerKg);
    parsed.forEach((row, index) => {
      const rates =
        row.pricePerKg != null && row.co2eKgPerKg != null
          ? { pricePerKg: row.pricePerKg, co2eKgPerKg: row.co2eKgPerKg }
          : null;
      out.set(index, { weightGrams: row.weightGrams, rates });
    });

    if (out.size < chunk.length) {
      this.logger.warn(
        `impact AI returned ${out.size}/${chunk.length} usable rows in ${country}`,
      );
    }

    return out;
  }

  /**
   * Chat call with timeout + retry. `temperature: 0` because these numbers are
   * written permanently into event logs and must not drift between runs.
   */
  protected async callAi(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<string> {
    const client = this.getOpenAi();
    if (!client) throw new Error('OPENAI_API_KEY is not configured');

    let lastErr: any;
    for (let attempt = 1; attempt <= this.AI_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.AI_TIMEOUT_MS);
      try {
        const response = await client.chat.completions.create(
          {
            model: this.AI_MODEL,
            messages,
            temperature: 0,
            response_format: { type: 'json_object' },
          },
          { signal: controller.signal as any },
        );
        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('empty AI content');
        return content;
      } catch (err: any) {
        lastErr = err;
        this.logger.warn(
          `impact AI attempt ${attempt}/${this.AI_MAX_ATTEMPTS} failed: ${err?.message}`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('impact AI failed');
  }

  private async readRates(
    nameKey: string,
    country: string,
  ): Promise<ImpactRates | null> {
    try {
      const cached = await this.redisService.get<CachedRates>(
        this.rateCacheKey(nameKey, country),
      );
      if (
        cached &&
        Number.isFinite(cached.p) &&
        Number.isFinite(cached.c) &&
        cached.p > 0 &&
        cached.c > 0
      ) {
        return { pricePerKg: cached.p, co2eKgPerKg: cached.c };
      }
    } catch (err: any) {
      this.logger.warn(`impact rate cache read failed: ${err?.message}`);
    }
    return null;
  }

  private async writeRates(
    nameKey: string,
    country: string,
    rates: ImpactRates,
  ): Promise<void> {
    try {
      await this.redisService.set(
        this.rateCacheKey(nameKey, country),
        { p: rates.pricePerKg, c: rates.co2eKgPerKg },
        this.RATE_CACHE_TTL_SEC,
      );
    } catch (err: any) {
      this.logger.warn(`impact rate cache write failed: ${err?.message}`);
    }
  }

  private async readWeight(
    nameKey: string,
    quantityKey: string,
  ): Promise<number | null> {
    try {
      const cached = await this.redisService.get<number>(
        this.weightCacheKey(nameKey, quantityKey),
      );
      if (cached == null) return null;
      return clampWeightGrams(cached);
    } catch (err: any) {
      this.logger.warn(`impact weight cache read failed: ${err?.message}`);
      return null;
    }
  }

  private async writeWeight(
    nameKey: string,
    quantityKey: string,
    grams: number,
  ): Promise<void> {
    if (!(grams > 0)) return;
    try {
      await this.redisService.set(
        this.weightCacheKey(nameKey, quantityKey),
        grams,
        this.WEIGHT_CACHE_TTL_SEC,
      );
    } catch (err: any) {
      this.logger.warn(`impact weight cache write failed: ${err?.message}`);
    }
  }
}
