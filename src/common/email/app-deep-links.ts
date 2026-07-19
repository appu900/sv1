export function getAppUniversalLinkBaseUrl(): string {
  return (
    process.env.APP_UNIVERSAL_LINK_BASE_URL ??
    process.env.APP_DEEP_LINK_BASE_URL ??
    'https://app.saveful.com'
  ).replace(/\/$/, '');
}

export function getBackendPublicBaseUrl(): string {
  return (
    process.env.BACKEND_PUBLIC_URL ??
    process.env.PUBLIC_API_URL ??
    'https://backend.saveful.app'
  ).replace(/\/$/, '');
}

export const APP_DEEP_LINK_PATHS = {
  inventory: '/inventory',
} as const;

export type AppDeepLinkDestination = keyof typeof APP_DEEP_LINK_PATHS;

export function buildAppUniversalLink(
  destination: AppDeepLinkDestination,
): string {
  return `${getAppUniversalLinkBaseUrl()}${APP_DEEP_LINK_PATHS[destination]}`;
}

export function buildEmailDeepLink(destination: AppDeepLinkDestination): string {
  return `${getBackendPublicBaseUrl()}/api/deeplink/${destination}`;
}
