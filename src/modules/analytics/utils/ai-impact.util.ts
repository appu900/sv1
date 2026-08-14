export const CO2E_KG_PER_KG_FALLBACK = 2.1;

export const CO2E_MIN_KG_PER_KG = 0.05;
export const CO2E_MAX_KG_PER_KG = 100;

export const PRICE_MIN_MULTIPLE = 0.05;
export const PRICE_MAX_MULTIPLE = 500;

export const NEGLIGIBLE_QUANTITY_RE =
  /^(to taste|for garnish|garnish|as needed|as required|optional|a pinch|pinch|some|dash|splash)$/i;

export const MAX_ITEMS_PER_AI_CALL = 25;

export interface ImpactRates {
  pricePerKg: number;
  co2eKgPerKg: number;
}

export interface ResolvedImpact {
  ingredient: string;
  weightInGrams: number;
  priceInLocalCurrency: number;
  co2SavedInGrams: number;
  source: 'ai' | 'cache' | 'fallback';
}

export interface ImpactRequestItem {
  name: string;
  quantity?: string;
  weightGrams?: number;
}

export function normalizeIngredientKey(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export function normalizeQuantityKey(quantity: string): string {
  return (quantity || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}

export function isNegligibleQuantity(quantity?: string | null): boolean {
  if (!quantity) return false;
  return NEGLIGIBLE_QUANTITY_RE.test(quantity.trim());
}

export function clampCo2eKgPerKg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < CO2E_MIN_KG_PER_KG || n > CO2E_MAX_KG_PER_KG) return null;
  return Number(n.toFixed(3));
}

export function clampPricePerKg(
  value: unknown,
  flatPricePerKg: number,
): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

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


export function clampWeightGrams(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 50_000) return null;
  return Number(n.toFixed(1));
}


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


export const CO2E_ANCHORS =
  'beef 60, lamb 24, cheese 21, prawns 12, pork 7, poultry 6, fish 5, eggs 4.5, ' +
  'rice 4, oils 3, milk 3, tofu 3, nuts 2.3, bread 1.6, legumes 0.9, ' +
  'fruit 0.7, vegetables 0.5, root vegetables 0.4';

export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}


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

export function chunkItems<T>(items: T[], size = MAX_ITEMS_PER_AI_CALL): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
