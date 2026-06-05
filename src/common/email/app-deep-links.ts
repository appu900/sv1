/** Where the mobile app resolves universal links (associated domain). */
export function getAppUniversalLinkBaseUrl(): string {
  return (
    process.env.APP_UNIVERSAL_LINK_BASE_URL ??
    process.env.APP_DEEP_LINK_BASE_URL ??
    'https://app.saveful.com'
  ).replace(/\/$/, '');
}

/** Public API host used in emails and share links. */
export function getBackendPublicBaseUrl(): string {
  return (
    process.env.BACKEND_PUBLIC_URL ??
    process.env.PUBLIC_API_URL ??
    'https://backend.saveful.app'
  ).replace(/\/$/, '');
}

export const APP_DEEP_LINK_PATHS = {
  /** My Pantry / kitchen inventory — add fridge, freezer, pantry items */
  inventory: '/inventory',
} as const;

export type AppDeepLinkDestination = keyof typeof APP_DEEP_LINK_PATHS;

/** Universal link opened by the app after redirect. */
export function buildAppUniversalLink(
  destination: AppDeepLinkDestination,
): string {
  return `${getAppUniversalLinkBaseUrl()}${APP_DEEP_LINK_PATHS[destination]}`;
}

/** Link in emails — hits backend first, then redirects into the app. */
export function buildEmailDeepLink(destination: AppDeepLinkDestination): string {
  return `${getBackendPublicBaseUrl()}/api/deeplink/${destination}`;
}
