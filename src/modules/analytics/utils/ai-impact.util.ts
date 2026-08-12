/**
 * Pure helpers for AI-assisted, per-ingredient impact estimation.
 *
 * Design note — why the AI returns *rates*, not totals:
 *
 * The model is asked for price-per-kg and CO2e-per-kg, which are independent of
 * how much of the ingredient a given user actually used. That makes a single
 * resolution reusable for every weight and every quantity string of that
 * ingredient, so the Redis cache hit rate is far higher than caching a total
 * priced for one specific weight. Weight resolution (quantity -> grams) is
 * cached separately and is country-independent, because a cup of rice weighs
 * the same everywhere.
 *
 * Everything in this file is deliberately free of I/O so it can be unit tested
 * without a network or a Redis instance.
 */

/** Platform default CO2e factor (kg CO2e avoided per kg food saved). */
export const CO2E_KG_PER_KG_FALLBACK = 2.1;

/**
 * Plausible band for a food CO2e emission factor (kg CO2e per kg food).
 * Beef tops real-world tables around 60; nothing edible sits outside this band.
 * A value outside it means the model hallucinated, so we drop back to the
 * platform default rather than writing nonsense into a permanent event log.
 */
export const CO2E_MIN_KG_PER_KG = 0.05;
export const CO2E_MAX_KG_PER_KG = 100;

/**
 * Price sanity band, as a multiple of the country's flat cost-per-kg.
 * Wide on purpose: real ingredients genuinely span three orders of magnitude
 * (onions to saffron). This only catches catastrophic values, not variance.
 */
export const PRICE_MIN_MULTIPLE = 0.05;
export const PRICE_MAX_MULTIPLE = 500;

/** Quantities that carry no meaningful weight — never worth an AI call. */
export const NEGLIGIBLE_QUANTITY_RE =
  /^(to taste|for garnish|garnish|as needed|as required|optional|a pinch|pinch|some|dash|splash)$/i;

/** Max items per AI request; larger recipes are split and run in parallel. */
export const MAX_ITEMS_PER_AI_CALL = 25;

export interface ImpactRates {
  /** Typical retail price for 1 kg, in the country's local currency. */
  pricePerKg: number;
  /** kg CO2e avoided per kg of this food. */
  co2eKgPerKg: number;
}

export interface ResolvedImpact {
  ingredient: string;
  weightInGrams: number;
  priceInLocalCurrency: number;
  co2SavedInGrams: number;
  /** Where the numbers came from — surfaced for observability, not for users. */
  source: 'ai' | 'cache' | 'fallback';
}

export interface ImpactRequestItem {
  name: string;
  /** Free-form quantity ("2 large", "1 cup"). When set, AI resolves grams. */
  quantity?: string;
  /** Already-known weight, used when no quantity string is supplied. */
  weightGrams?: number;
}

/**
 * Cache/lookup key for an ingredient name. Collapses case, whitespace and
 * trailing descriptors so "Large Onion " and "large onion" share one entry.
 */
export function normalizeIngredientKey(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/** Cache key fragment for a quantity string. */
export function normalizeQuantityKey(quantity: string): string {
  return (quantity || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}

export function isNegligibleQuantity(quantity?: string | null): boolean {
  if (!quantity) return false;
  return NEGLIGIBLE_QUANTITY_RE.test(quantity.trim());
}

/**
 * Accept a CO2e factor only if it is finite and inside the plausible band.
 * Returns null when the value should be discarded.
 */
export function clampCo2eKgPerKg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < CO2E_MIN_KG_PER_KG || n > CO2E_MAX_KG_PER_KG) return null;
  return Number(n.toFixed(3));
}

/**
 * Accept a price-per-kg only if it is finite and within a wide multiple of the
 * country's flat rate. Returns null when the value should be discarded.
 */
export function clampPricePerKg(
  value: unknown,
  flatPricePerKg: number,
): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

  // With no usable flat reference we can only reject non-finite/non-positive.
  if (!Number.isFinite(flatPricePerKg) || flatPricePerKg <= 0) {
    return Number(n.toFixed(4));
  }

  if (
    n < flatPricePerKg * PRICE_MIN_MULTIPLE ||
    n > flatPricePerKg * PRICE_MAX_MULTIPLE
  ) {
    return null;
  }
  return Number(n.toFixed(4));
}

/**
 * Accept an AI-resolved weight only if finite, non-negative and realistic.
 *
 * Zero is a legal weight here (a garnish), so absent values must be rejected
 * before the Number() coercion — Number(null) is 0, which would otherwise make
 * a cache miss indistinguishable from a genuine zero-weight ingredient.
 */
export function clampWeightGrams(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // 50 kg of a single ingredient in one home-cooked meal is not a real number.
  if (n > 50_000) return null;
  return Number(n.toFixed(1));
}

/**
 * Apply weight-independent rates to an actual weight.
 *
 *   price = kg x pricePerKg
 *   co2 grams = kg x co2eKgPerKg x 1000  (== grams x co2eKgPerKg)
 */
export function impactFromRates(
  weightInGrams: number,
  rates: ImpactRates,
): { priceInLocalCurrency: number; co2SavedInGrams: number } {
  const grams = Math.max(0, Number(weightInGrams) || 0);
  const kg = grams / 1000;
  return {
    priceInLocalCurrency: Math.round(kg * rates.pricePerKg * 100) / 100,
    co2SavedInGrams: Math.round(grams * rates.co2eKgPerKg),
  };
}

/**
 * CO2e calibration anchors handed to the model (kg CO2e per kg food).
 *
 * Anchoring is the single highest-leverage part of this prompt: without it the
 * same ingredient drifts run-to-run, and these numbers are written permanently
 * into event logs. Values track widely cited cradle-to-retail LCA figures.
 */
export const CO2E_ANCHORS =
  'beef 60, lamb 24, cheese 21, prawns 12, pork 7, poultry 6, fish 5, eggs 4.5, ' +
  'rice 4, oils 3, milk 3, tofu 3, nuts 2.3, bread 1.6, legumes 0.9, ' +
  'fruit 0.7, vegetables 0.5, root vegetables 0.4';

export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Build the batched estimation prompt.
 *
 * Optimisations that matter here:
 * - One request for the whole recipe instead of one per ingredient, so the
 *   system prompt is amortised across every item.
 * - Items are addressed by index and answers come back keyed by the same index,
 *   so no output tokens are spent echoing names and there is no fuzzy
 *   name-matching step on the way back in.
 * - Single-character response keys (g/p/c) to keep the completion small.
 * - Explicit units, explicit "numbers only", and calibration anchors, which is
 *   what actually keeps estimates stable across runs.
 */
export function buildImpactMessages(
  items: ImpactRequestItem[],
  country: string,
): AiChatMessage[] {
  const lines = items
    .map((item, idx) => {
      const qty = item.quantity?.trim();
      return `${idx + 1}. ${item.name.trim()}${qty ? ` | ${qty}` : ''}`;
    })
    .join('\n');

  const needsWeight = items.some(
    (i) => i.quantity && i.quantity.trim().length > 0,
  );

  return [
    {
      role: 'system',
      content:
        'You estimate food-waste impact. For each item return PER-KILOGRAM rates, ' +
        'never totals.\n' +
        `CO2e anchors (kg CO2e per kg food): ${CO2E_ANCHORS}. ` +
        'Interpolate from the nearest anchor for anything unlisted.\n' +
        'Rules:\n' +
        '- p = typical retail price of 1 kg in the given country, in that ' +
        "country's local currency, as a bare number (no symbol, no thousands separators).\n" +
        '- c = kg CO2e avoided per kg of that food, from the anchors above.\n' +
        '- g = edible weight in grams for the stated quantity, after peeling and ' +
        'trimming. Use 0 when no quantity is stated or the quantity is negligible ' +
        '("to taste", "a pinch", "for garnish").\n' +
        '- Estimate every item. Never return null, ranges, units or explanations.\n' +
        'Respond with STRICT JSON only.',
    },
    {
      role: 'user',
      content:
        `country: ${country}\n` +
        `items:\n${lines}\n\n` +
        'Return exactly:\n' +
        `{"r":[{"i":1,${needsWeight ? '"g":0,' : ''}"p":0,"c":0}]}\n` +
        `One entry per item, "i" matching the item number, ${items.length} entries total.`,
    },
  ];
}

interface ParsedImpactRow {
  index: number;
  weightGrams: number | null;
  pricePerKg: number | null;
  co2eKgPerKg: number | null;
}

/**
 * Parse and sanitise a batched AI response into per-index rows.
 *
 * Tolerates the handful of shapes the model realistically emits ({"r":[...]},
 * a bare array, or {"items":[...]}) and silently drops rows that fail the
 * sanity clamps, leaving the caller to fall back for those items.
 */
export function parseImpactResponse(
  content: string,
  itemCount: number,
  flatPricePerKg: number,
): Map<number, ParsedImpactRow> {
  const out = new Map<number, ParsedImpactRow>();

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }

  const rows: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.r)
      ? parsed.r
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.results)
          ? parsed.results
          : [];

  for (let position = 0; position < rows.length; position++) {
    const row = rows[position];
    if (!row || typeof row !== 'object') continue;

    // Prefer the echoed index; fall back to array position when absent.
    const rawIndex = Number(row.i ?? row.index);
    const index = Number.isFinite(rawIndex) ? rawIndex : position + 1;
    if (index < 1 || index > itemCount) continue;

    out.set(index, {
      index,
      weightGrams: clampWeightGrams(row.g ?? row.weightInGrams),
      pricePerKg: clampPricePerKg(row.p ?? row.pricePerKg, flatPricePerKg),
      co2eKgPerKg: clampCo2eKgPerKg(row.c ?? row.co2eKgPerKg),
    });
  }

  return out;
}

/** Split a list into fixed-size chunks for parallel AI calls. */
export function chunkItems<T>(items: T[], size = MAX_ITEMS_PER_AI_CALL): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
