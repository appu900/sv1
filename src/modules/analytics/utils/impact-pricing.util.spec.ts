import {
  CO2_KG_PER_KG_FOOD_SAVED,
  countryToSurveyCode,
  moneySavedFromFoodGrams,
  co2SavedInGramsFromFood,
  resolveCostPerGram,
  DEFAULT_COST_PER_GRAM,
} from './impact-pricing.util';

describe('impact-pricing.util', () => {
  const surveyRates = [
    { countryCode: 'AU', countryName: 'Australia', costPerGram: 0.004, isActive: true },
    { countryCode: 'US', countryName: 'United States', costPerGram: 0.003, isActive: true },
    { countryCode: 'IN', countryName: 'India', costPerGram: 0.015, isActive: true },
  ];

  describe('countryToSurveyCode', () => {
    it('maps Australia / AU', () => {
      expect(countryToSurveyCode('Australia')).toBe('AU');
      expect(countryToSurveyCode('AU')).toBe('AU');
    });

    it('maps United States', () => {
      expect(countryToSurveyCode('United States')).toBe('US');
      expect(countryToSurveyCode('US')).toBe('US');
    });
  });

  describe('resolveCostPerGram', () => {
    it('uses survey rate for AU', () => {
      expect(resolveCostPerGram('Australia', surveyRates)).toBe(0.004);
    });

    it('falls back to DEFAULT_COST_PER_GRAM when rates missing', () => {
      expect(resolveCostPerGram('Australia', [])).toBe(DEFAULT_COST_PER_GRAM.AU);
      expect(resolveCostPerGram('United States', null)).toBe(DEFAULT_COST_PER_GRAM.US);
    });
  });

  describe('moneySavedFromFoodGrams', () => {
    it('AU 3000g → $12.00 (0.004/g)', () => {
      expect(moneySavedFromFoodGrams(3000, 'Australia', surveyRates)).toBe(12);
    });

    it('US 3000g → $9.00 (0.003/g)', () => {
      expect(moneySavedFromFoodGrams(3000, 'United States', surveyRates)).toBe(9);
    });

    it('uses default rates when survey rates unavailable', () => {
      expect(moneySavedFromFoodGrams(3000, 'Australia', null)).toBe(12);
    });

    it('uses fallback $/kg for unknown country with no default code', () => {
      // Unknown country → no survey code → fallbackPriceInLocalCurrency → $5/kg default
      expect(moneySavedFromFoodGrams(2000, 'Atlantis', null)).toBe(10);
    });

    it('returns 0 for empty food', () => {
      expect(moneySavedFromFoodGrams(0, 'Australia', surveyRates)).toBe(0);
    });
  });

  describe('co2SavedInGramsFromFood', () => {
    it('uses platform factor 2.1', () => {
      expect(CO2_KG_PER_KG_FOOD_SAVED).toBe(2.1);
      expect(co2SavedInGramsFromFood(3000)).toBe(6300);
    });
  });
});
