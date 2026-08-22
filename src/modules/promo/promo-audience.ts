import {
  PromoAudienceMembership,
  PromoCard,
  PromoPlatform,
} from '../../database/schemas/promo-card.schema';
import { PerksMembershipPlan } from '../../database/schemas/perks-membership.schema';

/**
 * Everything the audience rules are evaluated against. Anonymous callers are a
 * first-class case: `isMember: false` with a null plan, which is exactly the
 * "non-member" variant the design asks for.
 */
export interface PromoViewerContext {
  isMember: boolean;
  plan: PerksMembershipPlan | null;
  country: string | null;
  platform: PromoPlatform | null;
  appVersion: string | null;
  now: Date;
}

/**
 * Numeric-segment comparison, tolerant of a `-beta`/`+build` suffix and of
 * differing segment counts ("3.1" < "3.1.1"). Returns <0, 0 or >0.
 *
 * Not a full semver implementation: prerelease tags are stripped rather than
 * ordered, because app versions here are always plain `major.minor.patch`.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .split(/[-+]/)[0]
      .split('.')
      .map((segment) => {
        const parsed = Number.parseInt(segment, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** An empty targeting array means "any", so it matches without inspecting the viewer. */
function matchesList<T>(allowed: T[] | undefined, actual: T | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  // A constraint we cannot evaluate is treated as unmet rather than ignored, so
  // a card is never shown to an audience it was explicitly restricted away from.
  if (actual == null) return false;
  return allowed.includes(actual);
}

export function matchesSchedule(card: PromoCard, now: Date): boolean {
  const startsAt = card.schedule?.startsAt;
  const endsAt = card.schedule?.endsAt;
  if (startsAt && now < new Date(startsAt)) return false;
  if (endsAt && now > new Date(endsAt)) return false;
  return true;
}

export function matchesAppVersion(
  card: PromoCard,
  appVersion: string | null,
): boolean {
  const { minAppVersion, maxAppVersion } = card.audience ?? {};
  if (!minAppVersion && !maxAppVersion) return true;
  if (!appVersion) return false;

  if (minAppVersion && compareVersions(appVersion, minAppVersion) < 0) {
    return false;
  }
  if (maxAppVersion && compareVersions(appVersion, maxAppVersion) > 0) {
    return false;
  }
  return true;
}

export function matchesMembership(card: PromoCard, isMember: boolean): boolean {
  switch (card.audience?.membership) {
    case PromoAudienceMembership.MEMBER:
      return isMember;
    case PromoAudienceMembership.NON_MEMBER:
      return !isMember;
    default:
      return true;
  }
}

/** True when every audience, schedule and version rule on the card is satisfied. */
export function matchesViewer(
  card: PromoCard,
  viewer: PromoViewerContext,
): boolean {
  if (!card.isActive) return false;
  if (!matchesSchedule(card, viewer.now)) return false;
  if (!matchesMembership(card, viewer.isMember)) return false;
  if (!matchesList(card.audience?.plans, viewer.plan)) return false;
  if (!matchesList(card.audience?.platforms, viewer.platform)) return false;
  if (
    !matchesList(
      card.audience?.countries?.map((code) => code.toUpperCase()),
      viewer.country ? viewer.country.toUpperCase() : null,
    )
  ) {
    return false;
  }
  return matchesAppVersion(card, viewer.appVersion);
}

/**
 * Picks the winning card per placement: highest priority, then most recently
 * updated. Returns at most one card for any given placement so the app never
 * has to arbitrate between two campaigns on the same screen.
 */
export function selectWinningCards<T extends PromoCard>(
  cards: T[],
  viewer: PromoViewerContext,
): T[] {
  const byPlacement = new Map<string, T>();

  for (const card of cards) {
    if (!matchesViewer(card, viewer)) continue;

    const incumbent = byPlacement.get(card.placement);
    if (!incumbent || beats(card, incumbent)) {
      byPlacement.set(card.placement, card);
    }
  }

  return [...byPlacement.values()];
}

function beats(candidate: PromoCard, incumbent: PromoCard): boolean {
  const priorityDiff = (candidate.priority ?? 0) - (incumbent.priority ?? 0);
  if (priorityDiff !== 0) return priorityDiff > 0;

  const updatedAt = (card: PromoCard): number => {
    const value = (card as PromoCard & { updatedAt?: Date }).updatedAt;
    return value ? new Date(value).getTime() : 0;
  };
  return updatedAt(candidate) > updatedAt(incumbent);
}
