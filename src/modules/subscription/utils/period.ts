
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

function isValidDate(value?: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcMonthsClamped(date: Date, delta: number): Date {
  const rawMonth = date.getUTCMonth() + delta;
  const year = date.getUTCFullYear() + Math.floor(rawMonth / 12);
  const month = ((rawMonth % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month));

  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function inferPeriodStartFromExpiry(
  expiresAt: Date,
  productId?: string | null,
): Date {
  const id = productId?.toLowerCase() ?? '';
  if (/(year|annual)/.test(id)) {
    return addUtcMonthsClamped(expiresAt, -12);
  }
  return addUtcMonthsClamped(expiresAt, -1);
}

function periodKeyFor(start: Date, end: Date): string {
  return `billing:${start.toISOString()}:${end.toISOString()}`;
}

export function currentUsagePeriod(
  source?: SubscriptionPeriodSource,
  now: Date = new Date(),
): {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
} {
  const isPaidPlan = source?.plan === 'hero' || source?.plan === 'legend';
  const expiresAt = source?.expiresAt;

  if (!isPaidPlan || !isValidDate(expiresAt) || expiresAt.getTime() <= now.getTime()) {
    return currentPeriod(now);
  }

  let periodStart = isValidDate(source?.purchasedAt)
    ? source.purchasedAt
    : inferPeriodStartFromExpiry(expiresAt, source?.productId);

  if (periodStart.getTime() >= expiresAt.getTime()) {
    periodStart = inferPeriodStartFromExpiry(expiresAt, source?.productId);
  }

  if (periodStart.getTime() >= expiresAt.getTime()) {
    return currentPeriod(now);
  }

  return {
    periodKey: periodKeyFor(periodStart, expiresAt),
    periodStart,
    periodEnd: expiresAt,
  };
}
