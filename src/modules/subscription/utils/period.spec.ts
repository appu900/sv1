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

  it('uses a calendar month for monthly paid subscribers (limit is per-month)', () => {
    const period = currentUsagePeriod(
      {
        plan: 'hero',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2026-05-25T09:30:00.000Z'),
        productId: 'saveful.hero.monthly',
      },
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(period.periodKey).toBe('2026-05');
  });

  it('uses a calendar month for yearly paid subscribers so PerMonth limits actually reset monthly', () => {
    
    const period = currentUsagePeriod(
      {
        plan: 'legend',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2027-04-25T09:30:00.000Z'),
        productId: 'saveful.legend.yearly',
      },
      new Date('2026-09-15T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(period.periodKey).toBe('2026-09');
  });
});
