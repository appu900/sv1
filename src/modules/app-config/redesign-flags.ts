import { createHash } from 'crypto';
import { compareVersions } from '../promo/promo-audience';

/**
 * Areas of the app redesign that can be switched on separately. Each groups
 * screens that link to each other, so old and new styles never mix inside
 * one flow.
 */
export const REDESIGN_AREAS = [
  'entry',
  'plans',
  'home',
  'kitchen',
  'shopping',
  'cookbook',
  'make',
  'tips',
  'track',
] as const;

export type RedesignArea = (typeof REDESIGN_AREAS)[number];

export interface AreaRule {
  enabled: boolean;
  /** Share of signed-in users who get the area, 0–100. */
  percent: number;
  /** Users who always get the area while it is enabled (QA, the client). */
  allowUserIds: string[];
  /** Oldest app version that has the new screens, e.g. "4.1.0". */
  minAppVersion?: string;
}

export type RedesignRules = Record<RedesignArea, AreaRule>;
export type RedesignFlags = Record<RedesignArea, boolean>;

/** An area only turns on when the areas it links into are on too. */
export const AREA_DEPENDENCIES: Partial<Record<RedesignArea, RedesignArea[]>> = {
  home: ['kitchen'],
  plans: ['entry'],
};

/** Areas shown before sign-in. These only switch on for everyone at 100%. */
export const PRE_LOGIN_AREAS: readonly RedesignArea[] = ['entry', 'plans'];

export function defaultRule(): AreaRule {
  return { enabled: false, percent: 0, allowUserIds: [] };
}

export function defaultRules(): RedesignRules {
  return Object.fromEntries(
    REDESIGN_AREAS.map(area => [area, defaultRule()]),
  ) as RedesignRules;
}

/** Stable 0–99 bucket per user and area, so a user's rollout never flips. */
export function rolloutBucket(userId: string, area: RedesignArea): number {
  const digest = createHash('sha1').update(`${area}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

export function isValidAppVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_RE.test(value.trim());
}

function areaOn(
  area: RedesignArea,
  rule: AreaRule,
  viewer: { userId: string | null; appVersion: string | null },
): boolean {
  if (!rule.enabled) return false;
  if (rule.minAppVersion) {
    // An app that does not say its version predates the redesign.
    if (!viewer.appVersion) return false;
    if (compareVersions(viewer.appVersion, rule.minAppVersion) < 0) return false;
  }
  if (!viewer.userId) {
    return PRE_LOGIN_AREAS.includes(area) && rule.percent >= 100;
  }
  if (rule.allowUserIds.includes(viewer.userId)) return true;
  if (rule.percent >= 100) return true;
  if (rule.percent <= 0) return false;
  return rolloutBucket(viewer.userId, area) < rule.percent;
}

/**
 * Turns stored rules into plain on/off flags for one viewer. Unknown or
 * missing rules count as off, so a bad config can only hide new screens.
 */
export function resolveRedesignFlags(
  rules: Partial<Record<string, Partial<AreaRule>>> | null | undefined,
  viewer: { userId: string | null; appVersion: string | null },
): RedesignFlags {
  const clean = normaliseRules(rules);
  const flags = Object.fromEntries(
    REDESIGN_AREAS.map(area => [area, areaOn(area, clean[area], viewer)]),
  ) as RedesignFlags;

  for (const area of REDESIGN_AREAS) {
    const needs = AREA_DEPENDENCIES[area] ?? [];
    if (flags[area] && needs.some(dep => !flags[dep])) flags[area] = false;
  }
  return flags;
}

/** Fills gaps and drops bad values; used for reads and admin writes. */
export function normaliseRules(
  rules: Partial<Record<string, Partial<AreaRule>>> | null | undefined,
): RedesignRules {
  const out = defaultRules();
  if (!rules || typeof rules !== 'object') return out;
  for (const area of REDESIGN_AREAS) {
    const raw = rules[area];
    if (!raw || typeof raw !== 'object') continue;
    const percent = Number(raw.percent);
    out[area] = {
      enabled: raw.enabled === true,
      percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0,
      allowUserIds: Array.isArray(raw.allowUserIds)
        ? raw.allowUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 200)
        : [],
      ...(isValidAppVersion(raw.minAppVersion)
        ? { minAppVersion: raw.minAppVersion.trim() }
        : {}),
    };
  }
  return out;
}
