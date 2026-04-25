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

  it('uses RevenueCat billing dates for paid usage reset periods', () => {
    const period = currentUsagePeriod(
      {
        plan: 'hero',
        purchasedAt: new Date('2026-04-25T09:30:00.000Z'),
        expiresAt: new Date('2026-05-25T09:30:00.000Z'),
        productId: 'saveful_hero_monthly',
      },
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-04-25T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-05-25T09:30:00.000Z');
    expect(period.periodKey).toBe(
      'billing:2026-04-25T09:30:00.000Z:2026-05-25T09:30:00.000Z',
    );
  });

  it('infers yearly billing starts from expiry when purchase date is missing', () => {
    const period = currentUsagePeriod(
      {
        plan: 'legend',
        expiresAt: new Date('2027-04-25T09:30:00.000Z'),
        productId: 'saveful_legend_yearly',
      },
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(period.periodStart.toISOString()).toBe('2026-04-25T09:30:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2027-04-25T09:30:00.000Z');
  });
});