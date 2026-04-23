import { MetricsWindow } from '../dto/metrics.dto';

export function normalizeTimezone(tz: string | null | undefined): string {
  if (!tz || typeof tz !== 'string') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function getOffsetMs(utcMs: number, tz: string): number {
  const d = new Date(utcMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  // Intl sometimes returns hour="24" at midnight — normalise.
  const hour = get('hour') % 24;
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUTC - utcMs;
}

function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  tz: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset1 = getOffsetMs(utcGuess, tz);
  const adjusted = utcGuess - offset1;
  const offset2 = getOffsetMs(adjusted, tz);
  return new Date(utcGuess - offset2);
}

export function windowStart(
  window: MetricsWindow | undefined,
  tz: string | null | undefined = 'UTC',
  now: Date = new Date(),
): Date | null {
  if (!window || window === MetricsWindow.ALL) return null;
  const timeZone = normalizeTimezone(tz);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const weekday = get('weekday');

  if (window === MetricsWindow.MONTH) {
    return zonedWallTimeToUtc(year, month, 1, timeZone);
  }
  if (window === MetricsWindow.YEAR) {
    return zonedWallTimeToUtc(year, 1, 1, timeZone);
  }
  const weekdayToBack: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const back = weekdayToBack[weekday] ?? 0;
  const tmp = new Date(Date.UTC(year, month - 1, day));
  tmp.setUTCDate(tmp.getUTCDate() - back);
  return zonedWallTimeToUtc(
    tmp.getUTCFullYear(),
    tmp.getUTCMonth() + 1,
    tmp.getUTCDate(),
    timeZone,
  );
}

export const GLOBAL_SCOPE_MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
