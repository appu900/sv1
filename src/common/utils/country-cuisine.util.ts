
export interface CountryCuisineContext {
  countryName: string;
  nutritionDatabases: string;
  cookingContext: string;
  cuisineFocus: string;
  exampleDishes: string;
}

const COUNTRY_CUISINE_MAP: Record<string, CountryCuisineContext> = {
  IN: {
    countryName: 'India',
    nutritionDatabases: 'IFCT (Indian Food Composition Tables) and USDA',
    cookingContext:
      'Indian cooking methods (oil, ghee, tempering/tadka, deep frying, pressure cooking, tandoor, etc.)',
    cuisineFocus: 'Indian cuisine',
    exampleDishes: 'dal, roti, biryani, dosa, paneer butter masala',
  },
  US: {
    countryName: 'United States',
    nutritionDatabases: 'USDA FoodData Central',
    cookingContext:
      'American cooking methods (grilling, baking, frying, slow cooking, etc.)',
    cuisineFocus: 'American cuisine',
    exampleDishes: 'burgers, mac and cheese, BBQ ribs, clam chowder, tacos',
  },
  GB: {
    countryName: 'United Kingdom',
    nutritionDatabases: 'UK Composition of Foods (CoF/McCance & Widdowson) and USDA',
    cookingContext:
      'British cooking methods (roasting, baking, frying, stewing, etc.)',
    cuisineFocus: 'British cuisine',
    exampleDishes: 'fish and chips, shepherd\'s pie, roast dinner, full English breakfast',
  },
  AU: {
    countryName: 'Australia',
    nutritionDatabases: 'AUSNUT (Australian Food Composition Database) and USDA',
    cookingContext:
      'Australian cooking methods (BBQ, grilling, baking, etc.)',
    cuisineFocus: 'Australian cuisine',
    exampleDishes: 'meat pies, pavlova, barramundi, vegemite on toast, lamingtons',
  },
  CA: {
    countryName: 'Canada',
    nutritionDatabases: 'Canadian Nutrient File (CNF) and USDA',
    cookingContext:
      'Canadian cooking methods (baking, grilling, slow cooking, etc.)',
    cuisineFocus: 'Canadian cuisine',
    exampleDishes: 'poutine, butter tarts, tourtière, Montreal smoked meat',
  },
  CN: {
    countryName: 'China',
    nutritionDatabases: 'China Food Composition Tables and USDA',
    cookingContext:
      'Chinese cooking methods (wok stir-frying, steaming, braising, deep frying, etc.)',
    cuisineFocus: 'Chinese cuisine',
    exampleDishes: 'kung pao chicken, fried rice, dim sum, mapo tofu, hot pot',
  },
  JP: {
    countryName: 'Japan',
    nutritionDatabases: 'Standard Tables of Food Composition in Japan and USDA',
    cookingContext:
      'Japanese cooking methods (simmering, grilling/yakimono, deep frying/tempura, raw preparation, etc.)',
    cuisineFocus: 'Japanese cuisine',
    exampleDishes: 'sushi, ramen, tempura, tonkatsu, miso soup',
  },
  KR: {
    countryName: 'South Korea',
    nutritionDatabases: 'Korean Food Composition Table and USDA',
    cookingContext:
      'Korean cooking methods (fermentation, grilling, stewing, stir-frying, etc.)',
    cuisineFocus: 'Korean cuisine',
    exampleDishes: 'kimchi jjigae, bibimbap, bulgogi, tteokbokki, japchae',
  },
  SG: {
    countryName: 'Singapore',
    nutritionDatabases: 'Singapore Food Composition Database and USDA',
    cookingContext:
      'Singaporean cooking methods (stir-frying, steaming, braising, grilling, etc.)',
    cuisineFocus: 'Singaporean and Southeast Asian cuisine',
    exampleDishes: 'Hainanese chicken rice, laksa, char kway teow, satay, nasi lemak',
  },
  AE: {
    countryName: 'United Arab Emirates',
    nutritionDatabases: 'GCC Food Composition Tables and USDA',
    cookingContext:
      'Middle Eastern cooking methods (grilling, slow cooking, frying, baking, etc.)',
    cuisineFocus: 'Middle Eastern and Emirati cuisine',
    exampleDishes: 'shawarma, hummus, machboos, luqaimat, harees',
  },
  DE: {
    countryName: 'Germany',
    nutritionDatabases: 'German Nutrient Database (BLS) and USDA',
    cookingContext:
      'German cooking methods (braising, roasting, baking, frying, etc.)',
    cuisineFocus: 'German cuisine',
    exampleDishes: 'schnitzel, bratwurst, sauerkraut, kartoffelsalat, spätzle',
  },
  FR: {
    countryName: 'France',
    nutritionDatabases: 'ANSES/Ciqual French Food Composition Table and USDA',
    cookingContext:
      'French cooking methods (sautéing, braising, poaching, baking, flambéing, etc.)',
    cuisineFocus: 'French cuisine',
    exampleDishes: 'ratatouille, coq au vin, crêpes, quiche lorraine, bouillabaisse',
  },
  NZ: {
    countryName: 'New Zealand',
    nutritionDatabases: 'New Zealand Food Composition Database and USDA',
    cookingContext:
      'New Zealand cooking methods (BBQ, roasting, baking, grilling, etc.)',
    cuisineFocus: 'New Zealand cuisine',
    exampleDishes: 'pavlova, hangi, meat pies, fish and chips, lamb roast',
  },
};

const DEFAULT_CONTEXT: CountryCuisineContext = {
  countryName: 'Global',
  nutritionDatabases: 'USDA FoodData Central and established international nutrition databases',
  cookingContext:
    'common cooking methods appropriate to the cuisine (frying, baking, grilling, steaming, etc.)',
  cuisineFocus: 'the cuisine most relevant to the dish being described',
  exampleDishes: 'various international dishes',
};

export function getCuisineContext(
  country?: string,
): CountryCuisineContext {
  if (!country) return DEFAULT_CONTEXT;

  // 1. Try the value as an ISO-2 code first (e.g. "IN", "US", "GB")
  const byCode = COUNTRY_CUISINE_MAP[country.toUpperCase()];
  if (byCode) return byCode;

  // 2. Fall back to a case-insensitive match against full countryName values
  //    (e.g. "India" → IN, "United States" → US)
  const lc = country.toLowerCase();
  const byName = Object.values(COUNTRY_CUISINE_MAP).find(
    (ctx) => ctx.countryName.toLowerCase() === lc,
  );
  if (byName) return byName;

  return DEFAULT_CONTEXT;
}

export function getCountryName(country?: string): string {
  if (!country) return 'Global';
  return (
    COUNTRY_CUISINE_MAP[country.toUpperCase()]?.countryName ?? country
  );
}
