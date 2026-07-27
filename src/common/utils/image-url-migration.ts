export const DEFAULT_CDN_BASE_URL = 'https://cdn.saveful.app';
export const DEFAULT_LEGACY_BUCKETS = ['saveful', 'saveful1'] as const;

export type UrlRewriteResult = {
  changed: boolean;
  value: string;
  objectKey?: string;
};

export type ImageUrlValueChange = {
  path: string;
  before: string;
  after: string;
};

const IMAGE_FIELD_NAMES = new Set([
  'heroImageUrl',
  'imageUrl',
  'avatarImageUrl',
  'profileImageUrl',
  'profilePhotoUrl',
  'iconImageUrl',
  'thumbnailImageUrl',
  'sponsorLogoUrl',
  'logo',
  'logoBlackAndWhite',
  'blockImageUrl',
  'videoThumbnail',
  'headerLogoUrl',
]);

const HTML_FIELD_NAMES = new Set([
  'bodyHtml',
  'html',
  'description',
  'leadText',
  'text',
  'listText',
  'accordionText',
]);

function normalizeObjectKey(pathname: string): string | null {
  const rawSegments = pathname.replace(/^\/+/, '').split('/');
  if (!rawSegments.length || rawSegments.every((segment) => !segment)) {
    return null;
  }

  try {
    return rawSegments
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
  } catch {
    return null;
  }
}

export function buildCdnAssetUrl(
  objectKey: string,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
): string {
  const base = cdnBaseUrl.replace(/\/+$/, '');
  const key = normalizeObjectKey(objectKey);
  if (!key) {
    throw new Error('Object key cannot be empty or malformed');
  }
  return `${base}/${key}`;
}

export function rewriteLegacyS3Url(
  value: string,
  options: {
    cdnBaseUrl?: string;
    allowedBuckets?: readonly string[];
  } = {},
): UrlRewriteResult {
  const original = value;
  const allowedBuckets = new Set(
    options.allowedBuckets ?? DEFAULT_LEGACY_BUCKETS,
  );

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { changed: false, value: original };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { changed: false, value: original };
  }

  const hostname = url.hostname.toLowerCase();
  const virtualHostedMatch = hostname.match(
    /^([^.]+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/,
  );
  const pathStyleMatch = hostname.match(
    /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/,
  );

  let objectPath = url.pathname;
  if (virtualHostedMatch) {
    if (!allowedBuckets.has(virtualHostedMatch[1])) {
      return { changed: false, value: original };
    }
  } else if (pathStyleMatch) {
    const pathParts = url.pathname.replace(/^\/+/, '').split('/');
    const bucket = pathParts.shift();
    if (!bucket || !allowedBuckets.has(bucket)) {
      return { changed: false, value: original };
    }
    objectPath = pathParts.join('/');
  } else {
    return { changed: false, value: original };
  }

  const objectKey = normalizeObjectKey(objectPath);
  if (!objectKey) {
    return { changed: false, value: original };
  }

  return {
    changed: true,
    value: buildCdnAssetUrl(
      objectKey,
      options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    ),
    objectKey,
  };
}

export function rewriteLegacyS3ImagesInHtml(
  html: string,
  options: {
    cdnBaseUrl?: string;
    allowedBuckets?: readonly string[];
  } = {},
): UrlRewriteResult {
  let changed = false;
  const value = html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(
      /(\bsrc\s*=\s*)(["'])(.*?)\2/i,
      (match, prefix: string, quote: string, src: string) => {
        const rewritten = rewriteLegacyS3Url(src, options);
        if (!rewritten.changed) return match;
        changed = true;
        return `${prefix}${quote}${rewritten.value}${quote}`;
      },
    ),
  );

  return { changed, value };
}

export function collectLegacyImageUrlChanges(
  value: unknown,
  rootKey: string,
  options: {
    cdnBaseUrl?: string;
    allowedBuckets?: readonly string[];
  } = {},
): ImageUrlValueChange[] {
  const changes: ImageUrlValueChange[] = [];

  const visit = (
    current: unknown,
    pathParts: string[],
    key: string,
    parent: Record<string, unknown> | null,
    containerKey: string | null,
  ): void => {
    if (typeof current === 'string') {
      const isImageBlockValue =
        parent?.type === 'image' && (key === 'url' || key === 'text');
      const isImageUrl =
        IMAGE_FIELD_NAMES.has(key) ||
        containerKey === 'imageUrls' ||
        isImageBlockValue;
      const isHtml =
        HTML_FIELD_NAMES.has(key) || containerKey === 'bodyBlocks';
      const rewritten = isHtml
        ? rewriteLegacyS3ImagesInHtml(current, options)
        : isImageUrl
          ? rewriteLegacyS3Url(current, options)
          : { changed: false, value: current };

      if (rewritten.changed) {
        changes.push({
          path: pathParts.join('.'),
          before: current,
          after: rewritten.value,
        });
      }
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((entry, index) =>
        visit(
          entry,
          [...pathParts, String(index)],
          String(index),
          null,
          key,
        ),
      );
      return;
    }

    if (!current || typeof current !== 'object') return;
    const objectValue = current as Record<string, unknown>;
    Object.entries(objectValue).forEach(([childKey, childValue]) =>
      visit(
        childValue,
        [...pathParts, childKey],
        childKey,
        objectValue,
        key,
      ),
    );
  };

  visit(value, [rootKey], rootKey, null, null);
  return changes;
}
