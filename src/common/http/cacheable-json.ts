import * as crypto from 'crypto';
import { Request, Response } from 'express';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

export interface CacheableJsonOptions {
  /** Value of the client's `?v=` parameter, if any. */
  requestedVersion?: string;
  /** Current server-side data version for this collection. */
  currentVersion: number;
}

/**
 * Sends JSON with a strong content ETag and answers `If-None-Match` with a 304.
 *
 * When the client's `?v=` matches the current data version the URL genuinely
 * addresses immutable content, so shared caches may keep it forever. A stale or
 * absent `v` falls back to revalidation, which keeps a superseded URL from being
 * baked into nginx or CloudFront.
 */
export function sendCacheableJson(
  req: Request,
  res: Response,
  data: unknown,
  { requestedVersion, currentVersion }: CacheableJsonOptions,
): Response {
  const body = JSON.stringify(data ?? null);
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64')}"`;

  const isVersionPinned =
    requestedVersion !== undefined &&
    requestedVersion !== '' &&
    Number(requestedVersion) === currentVersion;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', isVersionPinned ? IMMUTABLE : REVALIDATE);
  res.setHeader('X-Data-Version', String(currentVersion));
  // `vary` appends, unlike setHeader, so the CORS `Vary: Origin` survives.
  res.vary('Accept-Encoding');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(body);
}
