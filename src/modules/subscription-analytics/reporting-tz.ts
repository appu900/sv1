/**
 * Reporting-timezone helpers for subscription analytics.
 * Timestamps are stored in UTC; "a day" means a calendar day in the
 * reporting timezone (Australia/Melbourne unless configured otherwise).
 */

export const DEFAULT_REPORTING_TZ = 'Australia/Melbourne';

export function reportingTimezone(): string {
  return process.env.SUBSCRIPTION_ANALYTICS_TZ?.trim() || DEFAULT_REPORTING_TZ;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string) {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" of the instant in the reporting timezone. */
export function dateKeyInTz(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseKey(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

/** UTC instant of local wall-clock time on a reporting day. */
function zonedInstant(key: string, h: number, mi: number, s: number, ms: number, tz: string): Date {
  const [y, m, d] = parseKey(key);
  const guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let result = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass settles DST transitions.
  result = guess - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

export function startOfDayInTz(key: string, tz: string): Date {
  return zonedInstant(key, 0, 0, 0, 0, tz);
}

export function endOfDayInTz(key: string, tz: string): Date {
  return zonedInstant(key, 23, 59, 59, 999, tz);
}

export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  for (let k = fromKey; k <= toKey; k = addDaysToKey(k, 1)) keys.push(k);
  return keys;
}
