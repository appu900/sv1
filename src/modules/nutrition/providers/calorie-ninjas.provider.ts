import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FoodCategory,
  FoodSource,
} from '../../../database/schemas/nutrition/food-item.schema';
import { NormalizedFood } from './open-food-facts.provider';

const API_BASE = 'https://api.calorieninjas.com/v1/nutrition';

interface CalorieNinjasItem {
  name: string;
  calories: number;
  serving_size_g: number;
  fat_total_g: number;
  fat_saturated_g: number;
  protein_g: number;
  sodium_mg: number;
  potassium_mg: number;
  cholesterol_mg: number;
  carbohydrates_total_g: number;
  fiber_g: number;
  sugar_g: number;
}

interface CalorieNinjasResponse {
  items: CalorieNinjasItem[];
}


@Injectable()
export class CalorieNinjasProvider {
  private readonly logger = new Logger(CalorieNinjasProvider.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('CALORIE_NINJAS_API_KEY', '');
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async search(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<NormalizedFood[]> {
    if (!this.isAvailable()) {
      this.logger.warn('CalorieNinjas API key not configured — skipping');
      return [];
    }

    const q = query.trim();
    if (!q) return [];
    const limit = opts.limit ?? 20;

    const url = `${API_BASE}?query=${encodeURIComponent(q)}`;

    try {
      const res = await fetch(url, {
        headers: { 'X-Api-Key': this.apiKey },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        this.logger.warn(
          `CalorieNinjas HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        );
        return [];
      }

      const data: CalorieNinjasResponse = await res.json();

      if (!data.items?.length) return [];

      return data.items.slice(0, limit).map((item) => this.normalize(item));
    } catch (err) {
      this.logger.warn(
        `CalorieNinjas search error: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private normalize(item: CalorieNinjasItem): NormalizedFood {
    const displayName = this.titleCase(item.name);
    const servingG = item.serving_size_g || 100;

    const scale = servingG > 0 ? 100 / servingG : 1;

    return {
      canonicalName: item.name.toLowerCase().trim(),
      displayName,
      aliases: [],
      brand: null,
      barcode: null,
      category: this.guessCategory(item.name),
      servingOptions: [
        {
          label: `1 serving (${Math.round(servingG)}g)`,
          grams: Math.round(servingG),
          isDefault: true,
        },
        { label: '100 g', grams: 100 },
      ],
      per100g: {
        kcal: this.round(item.calories * scale),
        protein_g: this.round(item.protein_g * scale),
        carbs_g: this.round(item.carbohydrates_total_g * scale),
        fat_g: this.round(item.fat_total_g * scale),
        fiber_g: this.round(item.fiber_g * scale),
        sugar_g: this.round(item.sugar_g * scale),
        sodium_mg: this.round(item.sodium_mg * scale),
      },
      source: FoodSource.CALORIE_NINJAS,
      confidence: 0.85,
      verified: false,
      locale: 'in',
    };
  }

  private round(n: number): number {
    return Math.round(n * 10) / 10;
  }

  private titleCase(s: string): string {
    return s
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private guessCategory(name: string): FoodCategory {
    const n = name.toLowerCase();

    if (/\b(chai|tea|coffee|lassi|chaas|buttermilk|juice|nimbu|sharbat|milk)\b/.test(n))
      return FoodCategory.BEVERAGE;
    if (/\b(dal|dhal|lentil|sambar|rasam|rajma|chole|chana|moong)\b/.test(n))
      return FoodCategory.LEGUME;
    if (/\b(rice|roti|chapati|naan|paratha|puri|dosa|idli|upma|poha|bread|wheat)\b/.test(n))
      return FoodCategory.GRAIN;
    if (/\b(paneer|curd|dahi|yogurt|cheese|ghee|butter|cream)\b/.test(n))
      return FoodCategory.DAIRY;
    if (/\b(chicken|mutton|lamb|fish|egg|prawn|shrimp|keema|meat)\b/.test(n))
      return FoodCategory.PROTEIN;
    if (/\b(gulab jamun|rasgulla|jalebi|halwa|kheer|ladoo|barfi|sweet|mithai)\b/.test(n))
      return FoodCategory.SWEET;
    if (/\b(samosa|pakora|bhaji|vada|bhel|chaat|pani puri|chips|namkeen)\b/.test(n))
      return FoodCategory.SNACK;
    if (/\b(pickle|chutney|raita|achar|sauce)\b/.test(n))
      return FoodCategory.CONDIMENT;
    if (/\b(oil|ghee|coconut oil)\b/.test(n))
      return FoodCategory.FAT_OIL;
    if (/\b(apple|banana|mango|orange|grape|papaya|guava|fruit)\b/.test(n))
      return FoodCategory.FRUIT;
    if (/\b(potato|onion|tomato|spinach|gobi|bhindi|baingan|vegetable|sabzi)\b/.test(n))
      return FoodCategory.VEGETABLE;
    if (/\b(curry|masala|biryani|pulao|korma|tikka|tandoori)\b/.test(n))
      return FoodCategory.DISH;

    return FoodCategory.OTHER;
  }
}
