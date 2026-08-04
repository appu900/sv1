const FALLBACK_PRICE_PER_KG: Record<string, number> = {
  India: 120,
  'United States': 6,
  'United Kingdom': 5,
  Australia: 8,
  Canada: 7,
  Germany: 6,
  France: 6,
  Japan: 800,
  Singapore: 9,
  'United Arab Emirates': 20,
};

const DEFAULT_PRICE_PER_KG_USD = 5;

export function fallbackPriceInLocalCurrency(
  weightInGrams: number,
  country: string,
): number {
  const perKg = FALLBACK_PRICE_PER_KG[country] ?? DEFAULT_PRICE_PER_KG_USD;
  const kg = Math.max(0, weightInGrams) / 1000;
  return Number((perKg * kg).toFixed(2));
}

/** kg CO₂e avoided per kg of food saved (platform standard). */
const FALLBACK_CO2_PER_KG_FOOD = 2.1;

export function fallbackCo2SavedKg(weightInGrams: number): number {
  const kg = Math.max(0, weightInGrams) / 1000;
  return Number((FALLBACK_CO2_PER_KG_FOOD * kg).toFixed(3));
}
