import {
  DiscardReason,
  WasteType,
} from '../../database/schemas/user-inventory.schema';

/**
 * First app version that understands the new bin categories (food
 * organics, general waste, recycling). Older apps, and apps that do not
 * send X-App-Version, get the old keys back.
 */
export const NEW_WASTE_KEYS_MIN_VERSION = '4.1.0';

/** The bins shown in the redesign. */
export const CURRENT_WASTE_TYPES = [
  WasteType.FOOD_ORGANICS,
  WasteType.GENERAL_WASTE,
  WasteType.RECYCLING,
] as const;

const LEGACY_TO_CURRENT: Record<string, WasteType> = {
  [WasteType.WET]: WasteType.FOOD_ORGANICS,
  [WasteType.DRY]: WasteType.RECYCLING,
  [WasteType.HAZARDOUS]: WasteType.GENERAL_WASTE,
};

const CURRENT_TO_LEGACY: Record<string, WasteType> = {
  [WasteType.FOOD_ORGANICS]: WasteType.WET,
  [WasteType.RECYCLING]: WasteType.DRY,
  [WasteType.GENERAL_WASTE]: WasteType.DRY,
};

/** Stores only the new categories: old values from older apps are converted. */
export function normaliseWasteType(value?: string | null): WasteType | undefined {
  if (!value) return undefined;
  if (LEGACY_TO_CURRENT[value]) return LEGACY_TO_CURRENT[value];
  return (CURRENT_WASTE_TYPES as readonly string[]).includes(value)
    ? (value as WasteType)
    : undefined;
}

/** What an older app understands. */
export function toLegacyWasteType(value?: string | null): WasteType | undefined {
  if (!value) return undefined;
  if (CURRENT_TO_LEGACY[value]) return CURRENT_TO_LEGACY[value];
  return Object.prototype.hasOwnProperty.call(LEGACY_TO_CURRENT, value)
    ? (value as WasteType)
    : undefined;
}

/** Re-keys counts (e.g. byWasteType), adding together keys that merge. */
export function rekeyCounts(
  counts: Record<string, number>,
  mapKey: (key: string) => string | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(counts)) {
    const next = mapKey(key) ?? key;
    out[next] = (out[next] ?? 0) + n;
  }
  return out;
}

export type WasteAnalyticsPeriod = 'all' | '90d' | '30d' | '7d';
export const WASTE_ANALYTICS_PERIODS: readonly WasteAnalyticsPeriod[] = ['all', '90d', '30d', '7d'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of a rolling window, or null for all time. */
export function periodStart(period: WasteAnalyticsPeriod | undefined, now = Date.now()): Date | null {
  switch (period) {
    case '7d':
      return new Date(now - 7 * DAY_MS);
    case '30d':
      return new Date(now - 30 * DAY_MS);
    case '90d':
      return new Date(now - 90 * DAY_MS);
    default:
      return null;
  }
}

export function parsePeriod(value: unknown): WasteAnalyticsPeriod {
  return (WASTE_ANALYTICS_PERIODS as readonly unknown[]).includes(value)
    ? (value as WasteAnalyticsPeriod)
    : 'all';
}

/** Items eaten through a recipe: tracked as discarded, but not waste. */
export const NOT_WASTE_REASONS: readonly string[] = [DiscardReason.CONSUMED];
