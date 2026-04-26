import { currentPeriod, currentUsagePeriod } from './period';

describe('subscription usage periods', () => {
  it('keeps basic users on calendar-month periods', () => {
    const period = currentUsagePeriod(
      { plan: 'basic' },
      new Date('2026-04-25T10:00:00.000Z'),
    );

    expect(period).toEqual(currentPeriod(new Date('2026-04-25T10:00:00.000Z')));
    expect(period.periodStart.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('uses the RevenueCat billing period for monthly paid subscribers', () => {
    const period = currentUsagePeriod(
      {
        plan: 'hero',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2026-05-25T09:30:00.000Z'),
        productId: 'saveful.hero.monthly',
      },
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-04-25T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-05-25T09:30:00.000Z');
    expect(period.periodKey).toBe('billing:1777109400000-1779701400000');
  });

  it('uses monthly subperiods for yearly paid subscribers', () => {
    const period = currentUsagePeriod(
      {
        plan: 'legend',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2027-04-25T09:30:00.000Z'),
        productId: 'saveful.legend.yearly',
      },
      new Date('2026-09-15T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-08-25T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-09-25T09:30:00.000Z');
    expect(period.periodKey).toBe('billing:1787650200000-1790328600000');
  });

  it('clips the final yearly monthly subperiod to the entitlement expiry', () => {
    const period = currentUsagePeriod(
      {
        plan: 'hero',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2027-04-25T09:30:00.000Z'),
        productId: 'saveful.hero.yearly',
      },
      new Date('2027-04-20T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2027-03-25T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2027-04-25T09:30:00.000Z');
    expect(period.periodKey).toBe('billing:1805967000000-1808645400000');
  });

  it('keeps yearly monthly subperiods valid for end-of-month purchase dates', () => {
    const period = currentUsagePeriod(
      {
        plan: 'hero',
        purchasedAt: new Date('2026-01-31T09:30:00.000Z'),
        expiresAt: new Date('2027-01-31T09:30:00.000Z'),
        productId: 'saveful.hero.yearly',
      },
      new Date('2026-03-15T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-02-28T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-03-31T09:30:00.000Z');
    expect(period.periodKey).toBe('billing:1772271000000-1774949400000');
  });
});
