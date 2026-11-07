import { BadRequestException } from '@nestjs/common';

/** Screen keys the app sends, e.g. `kitchen_home`. Safe as a Mongo path segment. */
export const SAVI_VISIT_KEY_RE = /^[a-z0-9_]{1,40}$/;
/** Most increments one request may carry for a single key (the app batches). */
export const MAX_INCREMENT_PER_KEY = 50;
/** Most keys one request may carry. */
export const MAX_KEYS_PER_REQUEST = 32;
/** Most distinct keys stored per user, so the document cannot grow without bound. */
export const MAX_STORED_KEYS = 64;

export type SaviVisitCounts = Record<string, number>;

/**
 * Checks the body of POST /user/ui-state/savi-visits and returns the
 * increments as a clean map. Throws BadRequestException on bad input.
 */
export function parseSaviIncrements(input: unknown): SaviVisitCounts {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('increments must be an object');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    throw new BadRequestException('increments must not be empty');
  }
  if (entries.length > MAX_KEYS_PER_REQUEST) {
    throw new BadRequestException(
      `increments may hold at most ${MAX_KEYS_PER_REQUEST} keys`,
    );
  }
  const clean: SaviVisitCounts = {};
  for (const [key, value] of entries) {
    if (!SAVI_VISIT_KEY_RE.test(key)) {
      throw new BadRequestException(`invalid screen key: ${key.slice(0, 50)}`);
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_INCREMENT_PER_KEY
    ) {
      throw new BadRequestException(
        `increment for ${key} must be a whole number from 1 to ${MAX_INCREMENT_PER_KEY}`,
      );
    }
    clean[key] = value;
  }
  return clean;
}

/** Keys that would be new for this user. */
export function newKeys(
  existing: SaviVisitCounts | undefined,
  increments: SaviVisitCounts,
): string[] {
  return Object.keys(increments).filter(key => !(existing && key in existing));
}

/** Only well-formed counts, for responses (old or hand-edited data is ignored). */
export function cleanSaviVisits(value: unknown): SaviVisitCounts {
  if (!value || typeof value !== 'object') return {};
  const out: SaviVisitCounts = {};
  for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
    if (SAVI_VISIT_KEY_RE.test(key) && typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[key] = Math.floor(n);
    }
  }
  return out;
}
