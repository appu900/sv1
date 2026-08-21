export const CHEF_CACHE_TTL = 600;
export const CHEF_HOME_CACHE_TTL = 300;
export const CHEF_RECIPE_CHEFS_TTL = 3600;
export const CHEF_FAV_SET_TTL = 86400;
export const CHEF_UPLOAD_FOLDER = 'saveful/chef';

export const PUBLIC_CHEF_FILTER = { isPublished: true } as const;

export const CHEF_CACHE_KEYS = {
  home: (country?: string) =>
    `chefs:home:v2:${(country || 'all').toLowerCase()}`,
  list: (hash: string) => `chefs:list:v2:${hash}`,
  profile: (idOrSlug: string) => `chefs:profile:v2:${idOrSlug}`,
  recipes: (chefId: string, country: string, cursor: string) =>
    `chefs:recipes:v1:${chefId}:${country}:${cursor || 'start'}`,
  recipeChefs: (recipeId: string) => `chef:recipe-chefs:${recipeId}`,
  favSet: (userId: string) => `chef:fav:${userId}`,
  favLoaded: (userId: string) => `chef:fav:loaded:${userId}`,
  favCount: (chefId: string) => `chef:favcount:${chefId}`,
  userToProfile: (userId: string) => `chef:user-profile:${userId}`,
  patternAll: 'chefs:*',
  patternRecipeChefs: 'chef:recipe-chefs:*',
} as const;

export const CHEF_SNAPSHOT_KEYS = {
  popularWeek: 'popular:week',
  cuisineRail: 'cuisineRail',
  community: (period: 'month' | 'year' | 'all') => `community:${period}`,
  awards: (period: 'month' | 'year' | 'all') => `awards:${period}`,
} as const;

/** Rising-star eligibility and scoring knobs */
export const RISING_STAR = {
  minMealsCurrent30d: 25,
  previousFloor: 10,
} as const;

export const ALLOWED_CHEF_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Default currency when event/viewer country is missing */
export const DEFAULT_CURRENCY = 'AUD';

/** Rough country → currency for moneyByCurrency bucketing */
export const COUNTRY_CURRENCY: Record<string, string> = {
  AU: 'AUD',
  Australia: 'AUD',
  IN: 'INR',
  India: 'INR',
  US: 'USD',
  USA: 'USD',
  'United States': 'USD',
  GB: 'GBP',
  UK: 'GBP',
  'United Kingdom': 'GBP',
  NZ: 'NZD',
  'New Zealand': 'NZD',
  CA: 'CAD',
  Canada: 'CAD',
};

/** Display symbols for impact money labels (mockup: AUD$ X,XXX) */
export const CURRENCY_SYMBOL: Record<string, string> = {
  AUD: 'AUD$',
  INR: '₹',
  GBP: '£',
  NZD: 'NZ$',
  USD: 'US$',
  CAD: 'CA$',
};

export function currencyFromCountry(country?: string | null): string {
  if (!country) return DEFAULT_CURRENCY;
  return (
    COUNTRY_CURRENCY[country] ||
    COUNTRY_CURRENCY[country.toUpperCase()] ||
    DEFAULT_CURRENCY
  );
}

export function formatCurrencyLabel(currency: string, amount: number): string {
  const symbol = CURRENCY_SYMBOL[currency] || `${currency} `;
  return `${symbol} ${amount.toLocaleString()} Saved`;
}

/** Fold legacy UNKNOWN bucket into the default currency when reading */
export function normalizeMoneyByCurrency(
  moneyByCurrency: Record<string, number>,
): Record<string, number> {
  const out = { ...moneyByCurrency };
  if (out.UNKNOWN != null) {
    out[DEFAULT_CURRENCY] = (out[DEFAULT_CURRENCY] || 0) + out.UNKNOWN;
    delete out.UNKNOWN;
  }
  return out;
}

export function utcDayStart(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
