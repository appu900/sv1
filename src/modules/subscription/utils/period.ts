
export function currentPeriod(now: Date = new Date()): {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 1));
  const mm = String(month + 1).padStart(2, '0');
  return {
    periodKey: `${year}-${mm}`,
    periodStart,
    periodEnd,
  };
}

export interface SubscriptionPeriodSource {
  plan?: string | null;
  purchasedAt?: Date | null;
  expiresAt?: Date | null;
  productId?: string | null;
  periodType?: string | null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function hasYearlyProductId(productId: string | null | undefined): boolean {
  return /year|yearly|annual/i.test(productId ?? '');
}

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const millisecond = date.getUTCMilliseconds();
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, daysInTargetMonth),
      hour,
      minute,
      second,
      millisecond,
    ),
  );
}

function monthDelta(start: Date, end: Date): number {
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth()
  );
}

function shouldUseMonthlySubperiod(
  source: SubscriptionPeriodSource,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const durationMs = periodEnd.getTime() - periodStart.getTime();
  const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
  return hasYearlyProductId(source.productId) || durationMs > fortyFiveDaysMs;
}

function monthlySubperiod(
  entitlementStart: Date,
  entitlementEnd: Date,
  now: Date,
): {
  periodStart: Date;
  periodEnd: Date;
} {
  let offset = Math.max(0, monthDelta(entitlementStart, now));
  let periodStart = addMonthsClamped(entitlementStart, offset);

  while (periodStart.getTime() > now.getTime() && offset > 0) {
    offset -= 1;
    periodStart = addMonthsClamped(entitlementStart, offset);
  }

  let periodEnd = addMonthsClamped(entitlementStart, offset + 1);
  while (
    periodEnd.getTime() <= now.getTime() &&
    periodEnd.getTime() < entitlementEnd.getTime()
  ) {
    offset += 1;
    periodStart = periodEnd;
    periodEnd = addMonthsClamped(entitlementStart, offset + 1);
  }

  if (periodEnd.getTime() > entitlementEnd.getTime()) {
    periodEnd = new Date(entitlementEnd);
  }

  return {
    periodStart,
    periodEnd,
  };
}

export function currentUsagePeriod(
  source?: SubscriptionPeriodSource,
  now: Date = new Date(),
): {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
} {
  if (
    source?.plan &&
    source.plan !== 'basic' &&
    isValidDate(source.purchasedAt) &&
    isValidDate(source.expiresAt) &&
    source.purchasedAt.getTime() < source.expiresAt.getTime() &&
    now.getTime() >= source.purchasedAt.getTime() &&
    now.getTime() < source.expiresAt.getTime()
  ) {
    let periodStart = new Date(source.purchasedAt);
    let periodEnd = new Date(source.expiresAt);

    if (shouldUseMonthlySubperiod(source, periodStart, periodEnd)) {
      const subperiod = monthlySubperiod(periodStart, periodEnd, now);
      periodStart = subperiod.periodStart;
      periodEnd = subperiod.periodEnd;
    }

    return {
      periodKey: `billing:${periodStart.getTime()}-${periodEnd.getTime()}`,
      periodStart,
      periodEnd,
    };
  }

  return currentPeriod(now);
}
