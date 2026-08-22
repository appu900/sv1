import {
  PromoAudienceMembership,
  PromoCard,
  PromoPlacement,
  PromoPlatform,
} from '../../database/schemas/promo-card.schema';
import { PerksMembershipPlan } from '../../database/schemas/perks-membership.schema';
import {
  compareVersions,
  matchesViewer,
  PromoViewerContext,
  selectWinningCards,
} from './promo-audience';

const NOW = new Date('2026-08-22T00:00:00.000Z');

function card(overrides: Partial<PromoCard> = {}): PromoCard {
  return {
    name: 'test',
    placement: PromoPlacement.SHOPPING_LIST,
    priority: 0,
    isActive: true,
    audience: {
      membership: PromoAudienceMembership.ALL,
      plans: [],
      countries: [],
      platforms: [],
      minAppVersion: null,
      maxAppVersion: null,
    },
    schedule: { startsAt: null, endsAt: null },
    content: {
      title: 'Could you save on this shop?',
      body: 'See how much you could save.',
      ctaLabel: 'Calculate my savings',
      ctaDeepLink: '/perks/calculator',
      image: null,
    },
    style: {} as PromoCard['style'],
    behaviour: {} as PromoCard['behaviour'],
    ...overrides,
  } as PromoCard;
}

function viewer(overrides: Partial<PromoViewerContext> = {}): PromoViewerContext {
  return {
    isMember: false,
    plan: null,
    country: null,
    platform: PromoPlatform.IOS,
    appVersion: '3.0.10',
    now: NOW,
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders by numeric segment, not lexically', () => {
    expect(compareVersions('3.0.10', '3.0.9')).toBeGreaterThan(0);
    expect(compareVersions('3.0.9', '3.0.10')).toBeLessThan(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('3.1', '3.1.0')).toBe(0);
    expect(compareVersions('3.1', '3.1.1')).toBeLessThan(0);
  });

  it('ignores prerelease and build suffixes', () => {
    expect(compareVersions('3.0.10-beta.2', '3.0.10')).toBe(0);
    expect(compareVersions('3.0.10+ci7', '3.0.10')).toBe(0);
  });
});

describe('matchesViewer', () => {
  it('excludes inactive cards', () => {
    expect(matchesViewer(card({ isActive: false }), viewer())).toBe(false);
  });

  describe('membership', () => {
    const member = (m: PromoAudienceMembership) =>
      card({ audience: { ...card().audience, membership: m } });

    it('shows the non-member variant to anonymous and lapsed users', () => {
      const c = member(PromoAudienceMembership.NON_MEMBER);
      expect(matchesViewer(c, viewer({ isMember: false }))).toBe(true);
      expect(matchesViewer(c, viewer({ isMember: true }))).toBe(false);
    });

    it('shows the member variant only to active members', () => {
      const c = member(PromoAudienceMembership.MEMBER);
      expect(matchesViewer(c, viewer({ isMember: true }))).toBe(true);
      expect(matchesViewer(c, viewer({ isMember: false }))).toBe(false);
    });

    it('shows an "all" card to both', () => {
      const c = member(PromoAudienceMembership.ALL);
      expect(matchesViewer(c, viewer({ isMember: true }))).toBe(true);
      expect(matchesViewer(c, viewer({ isMember: false }))).toBe(true);
    });
  });

  describe('empty array means any', () => {
    it('matches every platform, plan and country when unset', () => {
      expect(
        matchesViewer(
          card(),
          viewer({
            platform: PromoPlatform.ANDROID,
            plan: PerksMembershipPlan.PAID,
            country: 'IN',
          }),
        ),
      ).toBe(true);
    });
  });

  describe('platform', () => {
    const iosOnly = card({
      audience: { ...card().audience, platforms: [PromoPlatform.IOS] },
    });

    it('includes the targeted platform and excludes the other', () => {
      expect(matchesViewer(iosOnly, viewer({ platform: PromoPlatform.IOS }))).toBe(true);
      expect(
        matchesViewer(iosOnly, viewer({ platform: PromoPlatform.ANDROID })),
      ).toBe(false);
    });

    it('excludes rather than ignores a constraint it cannot evaluate', () => {
      expect(matchesViewer(iosOnly, viewer({ platform: null }))).toBe(false);
    });
  });

  describe('plan and country', () => {
    it('matches a targeted plan', () => {
      const c = card({
        audience: {
          ...card().audience,
          plans: [PerksMembershipPlan.FREE_REGION],
        },
      });
      expect(matchesViewer(c, viewer({ plan: PerksMembershipPlan.FREE_REGION }))).toBe(true);
      expect(matchesViewer(c, viewer({ plan: PerksMembershipPlan.PAID }))).toBe(false);
    });

    it('matches country case-insensitively in both directions', () => {
      const c = card({ audience: { ...card().audience, countries: ['au'] } });
      expect(matchesViewer(c, viewer({ country: 'AU' }))).toBe(true);
      expect(matchesViewer(c, viewer({ country: 'au' }))).toBe(true);
      expect(matchesViewer(c, viewer({ country: 'IN' }))).toBe(false);
    });
  });

  describe('app version', () => {
    it('respects a minimum', () => {
      const c = card({
        audience: { ...card().audience, minAppVersion: '3.0.0' },
      });
      expect(matchesViewer(c, viewer({ appVersion: '3.0.10' }))).toBe(true);
      expect(matchesViewer(c, viewer({ appVersion: '2.9.9' }))).toBe(false);
    });

    it('respects a maximum', () => {
      const c = card({
        audience: { ...card().audience, maxAppVersion: '3.0.0' },
      });
      expect(matchesViewer(c, viewer({ appVersion: '3.0.0' }))).toBe(true);
      expect(matchesViewer(c, viewer({ appVersion: '3.0.1' }))).toBe(false);
    });

    it('excludes when a bound is set but the version is unknown', () => {
      const c = card({
        audience: { ...card().audience, minAppVersion: '3.0.0' },
      });
      expect(matchesViewer(c, viewer({ appVersion: null }))).toBe(false);
    });

    it('matches an unknown version when no bound is set', () => {
      expect(matchesViewer(card(), viewer({ appVersion: null }))).toBe(true);
    });
  });

  describe('schedule', () => {
    it('excludes before it starts and after it ends', () => {
      const future = card({
        schedule: { startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: null },
      });
      const past = card({
        schedule: { startsAt: null, endsAt: new Date('2026-08-01T00:00:00Z') },
      });
      expect(matchesViewer(future, viewer())).toBe(false);
      expect(matchesViewer(past, viewer())).toBe(false);
    });

    it('includes inside the window and when unbounded', () => {
      const live = card({
        schedule: {
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-09-01T00:00:00Z'),
        },
      });
      expect(matchesViewer(live, viewer())).toBe(true);
      expect(matchesViewer(card(), viewer())).toBe(true);
    });
  });
});

describe('selectWinningCards', () => {
  it('returns at most one card per placement, highest priority winning', () => {
    const low = card({ name: 'low', priority: 1 });
    const high = card({ name: 'high', priority: 5 });

    const won = selectWinningCards([low, high], viewer());

    expect(won).toHaveLength(1);
    expect(won[0].name).toBe('high');
  });

  it('breaks a priority tie on most recently updated', () => {
    const older = {
      ...card({ name: 'older', priority: 1 }),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } as PromoCard;
    const newer = {
      ...card({ name: 'newer', priority: 1 }),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    } as PromoCard;

    expect(selectWinningCards([older, newer], viewer())[0].name).toBe('newer');
    expect(selectWinningCards([newer, older], viewer())[0].name).toBe('newer');
  });

  it('keeps one winner for each distinct placement', () => {
    const won = selectWinningCards(
      [
        card({ placement: PromoPlacement.SHOPPING_LIST }),
        card({ placement: PromoPlacement.FEED_HOME }),
      ],
      viewer(),
    );
    expect(won.map((c) => c.placement).sort()).toEqual([
      PromoPlacement.FEED_HOME,
      PromoPlacement.SHOPPING_LIST,
    ]);
  });

  it('drops cards the viewer does not match', () => {
    const memberOnly = card({
      audience: {
        ...card().audience,
        membership: PromoAudienceMembership.MEMBER,
      },
    });
    expect(selectWinningCards([memberOnly], viewer({ isMember: false }))).toEqual([]);
  });
});
