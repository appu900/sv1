/**
 * Timezone-aware date helpers.
 *
 * All "today" dates in the nutrition module must respect the user's
 * IANA timezone (e.g. "Asia/Kolkata") so that the daily reset happens
 * at local midnight, not UTC midnight.
 */

/** Country-code → default IANA timezone (fallback when user.timezone is absent). */
const COUNTRY_TZ: Record<string, string> = {
  IN: 'Asia/Kolkata',
  US: 'America/New_York',
  GB: 'Europe/London',
  AU: 'Australia/Sydney',
  CA: 'America/Toronto',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  JP: 'Asia/Tokyo',
  CN: 'Asia/Shanghai',
  BR: 'America/Sao_Paulo',
  AE: 'Asia/Dubai',
  SG: 'Asia/Singapore',
  NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg',
  MX: 'America/Mexico_City',
  KR: 'Asia/Seoul',
  SA: 'Asia/Riyadh',
  PH: 'Asia/Manila',
  MY: 'Asia/Kuala_Lumpur',
  ID: 'Asia/Jakarta',
  TH: 'Asia/Bangkok',
  NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi',
  EG: 'Africa/Cairo',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo',
  NP: 'Asia/Kathmandu',
};

/**
 * Resolve user's IANA timezone.
 * Priority: explicit timezone > country fallback > UTC.
 */
export function resolveTimezone(
  timezone?: string | null,
  country?: string | null,
): string {
  if (timezone) return timezone;
  if (country) {
    const upper = country.toUpperCase();
    if (COUNTRY_TZ[upper]) return COUNTRY_TZ[upper];
  }
  return 'UTC';
}

/**
 * Return "YYYY-MM-DD" for "today" in the given IANA timezone.
 */
export function localDateISO(tz: string = 'UTC'): string {
  try {
    // Intl.DateTimeFormat with 'sv-SE' locale gives ISO-like format: YYYY-MM-DD
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // Bad timezone string → fall back to UTC
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Return "YYYY-MM" for the current month in the given IANA timezone.
 */
export function localMonthISO(tz: string = 'UTC'): string {
  return localDateISO(tz).slice(0, 7);
}
