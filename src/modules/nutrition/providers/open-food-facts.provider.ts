import { Injectable, Logger } from '@nestjs/common';
import {
  FoodCategory,
  FoodSource,
} from '../../../database/schemas/nutrition/food-item.schema';

const OFF_BASE = 'https://world.openfoodfacts.org';

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  categories_tags?: string[];
  countries_tags?: string[];
  serving_quantity?: number | string;
  serving_size?: string;
  nutriments?: {
    'energy-kcal_100g'?: number;
    'energy-kcal'?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    fiber_100g?: number;
    sugars_100g?: number;
    sodium_100g?: number;
    salt_100g?: number; 
  };
  completeness?: number;
  data_quality_errors_tags?: string[];
}

export interface NormalizedFood {
  canonicalName: string;
  displayName: string;
  aliases: string[];
  brand: string | null;
  barcode: string | null;
  category: FoodCategory;
  servingOptions: { label: string; grams: number; isDefault?: boolean }[];
  per100g: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    sodium_mg: number;
  };
  source: FoodSource;
  confidence: number;
  verified: boolean;
  locale: string;
}

@Injectable()
export class OpenFoodFactsProvider {
  private readonly logger = new Logger(OpenFoodFactsProvider.name);

  async fetchByBarcode(barcode: string): Promise<NormalizedFood | null> {
    const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(
      barcode,
    )}.json?fields=code,product_name,product_name_en,generic_name,brands,categories_tags,countries_tags,serving_quantity,serving_size,nutriments,completeness`;

    const res = await this.safeFetch(url);
    if (!res) return null;
    if (res.status === 0 || !res.product) return null;
    return this.normalize(res.product as OffProduct);
  }


  async search(
    query: string,
    opts: { pageSize?: number; country?: string } = {},
  ): Promise<NormalizedFood[]> {
    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50);
    const params = new URLSearchParams({
      search_terms: query,
      page_size: String(pageSize),
      fields:
        'code,product_name,product_name_en,generic_name,brands,categories_tags,countries_tags,serving_quantity,serving_size,nutriments,completeness',
      sort_by: 'popularity_key',
    });
    if (opts.country) params.set('countries_tags_en', opts.country);

    const url = `${OFF_BASE}/api/v2/search?${params.toString()}`;
    const res = await this.safeFetch(url);
    if (!res?.products) return [];

    return (res.products as OffProduct[])
      .map((p) => this.normalize(p))
      .filter((n): n is NormalizedFood => n !== null);
  }

  private async safeFetch(url: string): Promise<any | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'SavefulNutrition/1.0 (https://saveful.app; contact@saveful.app)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        this.logger.warn(`OFF fetch ${res.status} ${url}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      this.logger.warn(`OFF fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Map an OFF product → our FoodItem shape. Returns null if unusable. */
  private normalize(p: OffProduct): NormalizedFood | null {
    const n = p.nutriments ?? {};
    const kcal = numeric(n['energy-kcal_100g'] ?? n['energy-kcal']);
    if (kcal === null) return null; // without calories the entry is useless

    const name = (
      p.product_name_en ||
      p.product_name ||
      p.generic_name ||
      ''
    ).trim();
    if (!name) return null;

    const sodium_mg =
      numeric(n.sodium_100g) !== null
        ? (numeric(n.sodium_100g) as number) * 1000
        : numeric(n.salt_100g) !== null
          ? ((numeric(n.salt_100g) as number) * 1000) / 2.5
          : 0;

    const servingOptions: NormalizedFood['servingOptions'] = [
      { label: '100 g', grams: 100, isDefault: true },
    ];
    const servingGrams = numeric(p.serving_quantity);
    if (servingGrams && servingGrams > 0 && servingGrams !== 100) {
      servingOptions.push({
        label: p.serving_size?.trim() || `${servingGrams} g`,
        grams: servingGrams,
      });
    }

    return {
      canonicalName: name.toLowerCase(),
      displayName: name,
      aliases: uniqueNonEmpty([
        p.product_name,
        p.product_name_en,
        p.generic_name,
      ]).filter((a) => a.toLowerCase() !== name.toLowerCase()),
      brand: (p.brands?.split(',')[0] || '').trim() || null,
      barcode: (p.code || '').trim() || null,
      category: mapCategory(p.categories_tags ?? []),
      servingOptions,
      per100g: {
        kcal,
        protein_g: numeric(n.proteins_100g) ?? 0,
        carbs_g: numeric(n.carbohydrates_100g) ?? 0,
        fat_g: numeric(n.fat_100g) ?? 0,
        fiber_g: numeric(n.fiber_100g) ?? 0,
        sugar_g: numeric(n.sugars_100g) ?? 0,
        sodium_mg,
      },
      source: FoodSource.OPEN_FOOD_FACTS,
      confidence: clamp(
        (p.completeness ?? 0.6) * 0.9,
        0.3,
        0.9,
      ),
      verified: false, 
      locale: firstCountryLocale(p.countries_tags),
    };
  }
}


function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function uniqueNonEmpty(arr: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const t = (s ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function mapCategory(tags: string[]): FoodCategory {
  const joined = tags.join(' ').toLowerCase();
  if (/en:fruits?\b/.test(joined)) return FoodCategory.FRUIT;
  if (/en:vegetables?\b/.test(joined)) return FoodCategory.VEGETABLE;
  if (/en:(legumes?|pulses|lentils|beans)\b/.test(joined))
    return FoodCategory.LEGUME;
  if (/en:(cereals?|grains?|rice|pasta|bread|flour)\b/.test(joined))
    return FoodCategory.GRAIN;
  if (/en:(dairy|milks?|cheeses?|yogurts?|butters?)\b/.test(joined))
    return FoodCategory.DAIRY;
  if (/en:(meats?|poultry|fish|seafood|eggs?)\b/.test(joined))
    return FoodCategory.PROTEIN;
  if (/en:(oils?|fats?)\b/.test(joined)) return FoodCategory.FAT_OIL;
  if (/en:(beverages?|drinks?|waters|juices?|sodas?)\b/.test(joined))
    return FoodCategory.BEVERAGE;
  if (/en:(snacks?|chips|crisps|crackers)\b/.test(joined))
    return FoodCategory.SNACK;
  if (/en:(sweets?|desserts?|chocolates?|candies|biscuits?)\b/.test(joined))
    return FoodCategory.SWEET;
  if (/en:(sauces?|condiments?|spices?|seasonings?)\b/.test(joined))
    return FoodCategory.CONDIMENT;
  if (/en:(meals|dishes|prepared-foods)\b/.test(joined))
    return FoodCategory.DISH;
  if (/en:plant-based-foods/.test(joined)) return FoodCategory.OTHER;
  if (tags.length > 0) return FoodCategory.PACKAGED;
  return FoodCategory.OTHER;
}

function firstCountryLocale(tags?: string[]): string {
  if (!tags || tags.length === 0) return 'global';
  const first = tags.find((t) => t.startsWith('en:'));
  if (!first) return 'global';
  const country = first.replace('en:', '').trim();

  const map: Record<string, string> = {
    india: 'IN',
    'united-states': 'US',
    'united-kingdom': 'GB',
    france: 'FR',
    germany: 'DE',
    australia: 'AU',
    canada: 'CA',
  };
  return map[country] ?? 'global';
}
