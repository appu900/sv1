import { fallbackPriceInLocalCurrency } from './fallback-pricing.util';

export const CO2_KG_PER_KG_FOOD_SAVED = 2.1;

export const DEFAULT_COST_PER_GRAM: Record<string, number> = {
  IN: 0.015,
  AU: 0.004,
  NZ: 0.005,
  US: 0.003,
  GB: 0.0035,
  CA: 0.004,
  CN: 0.02,
  JP: 0.4,
  KR: 3.0,
  SG: 0.004,
  AE: 0.012,
  DE: 0.003,
  FR: 0.003,
};

const COUNTRY_TO_CODE: Record<string, string> = {
  AU: 'AU',
  Australia: 'AU',
  IN: 'IN',
  India: 'IN',
  US: 'US',
  USA: 'US',
  'United States': 'US',
  GB: 'GB',
  UK: 'GB',
  'United Kingdom': 'GB',
  NZ: 'NZ',
  'New Zealand': 'NZ',
  CA: 'CA',
  Canada: 'CA',
  CN: 'CN',
  China: 'CN',
  JP: 'JP',
  Japan: 'JP',
  KR: 'KR',
  'South Korea': 'KR',
  SG: 'SG',
  Singapore: 'SG',
  AE: 'AE',
  UAE: 'AE',
  'United Arab Emirates': 'AE',
  DE: 'DE',
  Germany: 'DE',
  FR: 'FR',
  France: 'FR',
};

export type CountryRateLike = {
  countryCode: string;
  countryName?: string;
  costPerGram: number;
  isActive?: boolean;
};

export function countryToSurveyCode(country?: string | null): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (!trimmed) return null;
  return (
    COUNTRY_TO_CODE[trimmed] ||
    COUNTRY_TO_CODE[trimmed.toUpperCase()] ||
    null
  );
}

export function resolveCostPerGram(
  country: string | null | undefined,
  countryRates?: CountryRateLike[] | null,
): number | null {
  const code = countryToSurveyCode(country);
  const activeRates = (countryRates || []).filter(
    (r) => r && (r.isActive === undefined || r.isActive) && Number(r.costPerGram) > 0,
  );

  if (code && activeRates.length > 0) {
    const byCode = activeRates.find(
      (r) => (r.countryCode || '').toUpperCase() === code,
    );
    if (byCode) return Number(byCode.costPerGram);

    const byName = activeRates.find(
      (r) =>
        (r.countryName || '').toLowerCase() === (country || '').toLowerCase(),
    );
    if (byName) return Number(byName.costPerGram);
  }

  if (code && DEFAULT_COST_PER_GRAM[code] != null) {
    return DEFAULT_COST_PER_GRAM[code];
  }

  return null;
}

export function moneySavedFromFoodGrams(
  foodSavedInGrams: number,
  country: string,
  countryRates?: CountryRateLike[] | null,
): number {
  const grams = Math.max(0, Number(foodSavedInGrams) || 0);
  if (grams <= 0) return 0;

  const costPerGram = resolveCostPerGram(country, countryRates);
  if (costPerGram != null && costPerGram > 0) {
    return Math.round(grams * costPerGram * 100) / 100;
  }

  return fallbackPriceInLocalCurrency(grams, country);
}

export function co2SavedInGramsFromFood(foodSavedInGrams: number): number {
  const grams = Math.max(0, Number(foodSavedInGrams) || 0);
  return grams * CO2_KG_PER_KG_FOOD_SAVED;
}
