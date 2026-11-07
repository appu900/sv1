import { compareVersions } from '../../modules/promo/promo-audience';

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

type HeaderBag = Record<string, string | string[] | undefined> | undefined;

/**
 * The app version from the `X-App-Version` header, or null. Apps before
 * 4.1.0 do not send it, so null means "an older app".
 */
export function getClientVersion(headers: HeaderBag): string | null {
  const raw = headers?.['x-app-version'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return VERSION_RE.test(trimmed) ? trimmed : null;
}

/** True when the caller's app is at least `min`; false for older or unknown apps. */
export function clientAtLeast(headers: HeaderBag, min: string): boolean {
  const version = getClientVersion(headers);
  return version !== null && compareVersions(version, min) >= 0;
}
