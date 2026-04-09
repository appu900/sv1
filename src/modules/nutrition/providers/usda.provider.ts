import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FoodCategory,
  FoodSource,
} from '../../../database/schemas/nutrition/food-item.schema';
import { NormalizedFood } from './open-food-facts.provider';


const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

const NUTRIENT_IDS = {
  ENERGY: 1008, 
  PROTEIN: 1003,
  FAT: 1004,
  CARBS: 1005,
  FIBER: 1079,
  SUGAR: 2000, 
  SODIUM: 1093,
} as const;

interface UsdaFoodNutrient {
  nutrientId: number;
  nutrientName: string;
  value: number;
  unitName: string;
}

interface UsdaSearchFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: string;
  foodNutrients: UsdaFoodNutrient[];
  servingSize?: number;
  servingSizeUnit?: string;
}

@Injectable()
export class UsdaProvider {
  private readonly logger = new Logger(UsdaProvider.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('USDA_API_KEY', '');
    if (!this.apiKey) {
      this.logger.warn(
        'USDA_API_KEY not set — USDA food search will be disabled. ' +
          'Get a free key at https://fdc.nal.usda.gov/api-key-signup',
      );
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(
    query: string,
    opts: { pageSize?: number } = {},
  ): Promise<NormalizedFood[]> {
    if (!this.apiKey) return [];

    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50);

    const url = `${USDA_BASE}/foods/search?${new URLSearchParams({
      api_key: this.apiKey,
      query,
      dataType: 'SR Legacy,Foundation',
      pageSize: String(pageSize),
      sortBy: 'dataType.keyword',
      sortOrder: 'asc',
    })}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        this.logger.warn(`USDA search ${res.status}: ${await res.text()}`);
        return [];
      }

      const data = await res.json();
      const foods = (data.foods ?? []) as UsdaSearchFood[];

      return foods
        .map((f) => this.normalize(f))
        .filter((n): n is NormalizedFood => n !== null);
    } catch (err) {
      this.logger.warn(`USDA search failed: ${(err as Error).message}`);
      return [];
    }
  }

  private normalize(f: UsdaSearchFood): NormalizedFood | null {
    const kcal = this.nutrient(f, NUTRIENT_IDS.ENERGY);
    if (kcal === null) return null;

    const name = (f.description ?? '').trim();
    if (!name) return null;

    const displayName = this.titleCase(name);

    const servingGrams = f.servingSize && f.servingSizeUnit?.toLowerCase() === 'g'
      ? f.servingSize
      : null;

    const servingOptions: NormalizedFood['servingOptions'] = [
      { label: '100 g', grams: 100, isDefault: true },
    ];
    if (servingGrams && servingGrams > 0 && servingGrams !== 100) {
      servingOptions.push({
        label: `1 serving (${servingGrams}g)`,
        grams: servingGrams,
      });
    }

    return {
      canonicalName: name.toLowerCase(),
      displayName,
      aliases: [],
      brand: null,
      barcode: null,
      category: this.mapCategory(f.foodCategory),
      servingOptions,
      per100g: {
        kcal,
        protein_g: this.nutrient(f, NUTRIENT_IDS.PROTEIN) ?? 0,
        carbs_g: this.nutrient(f, NUTRIENT_IDS.CARBS) ?? 0,
        fat_g: this.nutrient(f, NUTRIENT_IDS.FAT) ?? 0,
        fiber_g: this.nutrient(f, NUTRIENT_IDS.FIBER) ?? 0,
        sugar_g: this.nutrient(f, NUTRIENT_IDS.SUGAR) ?? 0,
        sodium_mg: this.nutrient(f, NUTRIENT_IDS.SODIUM) ?? 0,
      },
      source: FoodSource.USDA,
      confidence: 0.95, 
      verified: true,
      locale: 'global',
    };
  }

  private nutrient(food: UsdaSearchFood, id: number): number | null {
    const n = food.foodNutrients.find((fn) => fn.nutrientId === id);
    return n?.value != null && Number.isFinite(n.value) ? n.value : null;
  }

  private titleCase(s: string): string {
    return s
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bUht\b/g, 'UHT')
      .replace(/\bNfs\b/gi, '')
      .trim();
  }

  private mapCategory(cat?: string): FoodCategory {
    if (!cat) return FoodCategory.OTHER;
    const c = cat.toLowerCase();
    if (/fruit/.test(c)) return FoodCategory.FRUIT;
    if (/vegetable/.test(c)) return FoodCategory.VEGETABLE;
    if (/legume|bean|lentil|pulse/.test(c)) return FoodCategory.LEGUME;
    if (/cereal|grain|rice|bread|pasta|flour|wheat/.test(c)) return FoodCategory.GRAIN;
    if (/dairy|milk|cheese|yogurt|butter/.test(c)) return FoodCategory.DAIRY;
    if (/meat|poultry|fish|seafood|egg|chicken|beef|pork|lamb/.test(c)) return FoodCategory.PROTEIN;
    if (/oil|fat/.test(c)) return FoodCategory.FAT_OIL;
    if (/beverage|drink|juice|water|soda|tea|coffee/.test(c)) return FoodCategory.BEVERAGE;
    if (/snack|chip|cracker/.test(c)) return FoodCategory.SNACK;
    if (/sweet|dessert|candy|chocolate|sugar|baked/.test(c)) return FoodCategory.SWEET;
    if (/sauce|condiment|spice|seasoning/.test(c)) return FoodCategory.CONDIMENT;
    return FoodCategory.OTHER;
  }
}
