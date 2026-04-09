import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FoodCategory,
  FoodSource,
} from '../../../database/schemas/nutrition/food-item.schema';
import { NormalizedFood } from './open-food-facts.provider';


const UPCITEMDB_BASE = 'https://api.upcitemdb.com/prod/trial/lookup';

interface UpcItemDbItem {
  ean: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  size: string;
  weight: string;
}

interface UpcItemDbResponse {
  code: string;
  total: number;
  offset: number;
  items: UpcItemDbItem[];
}

@Injectable()
export class UpcItemDbProvider {
  private readonly logger = new Logger(UpcItemDbProvider.name);

  async fetchByBarcode(barcode: string): Promise<NormalizedFood | null> {
    const url = `${UPCITEMDB_BASE}?upc=${encodeURIComponent(barcode)}`;

    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SavefulNutrition/1.0',
        },
        signal: AbortSignal.timeout(6_000),
      });

      if (!res.ok) {
        this.logger.warn(`UpcItemDb HTTP ${res.status} for barcode ${barcode}`);
        return null;
      }

      const data: UpcItemDbResponse = await res.json();
      if (!data.items?.length) return null;

      return this.normalize(data.items[0], barcode);
    } catch (err) {
      this.logger.warn(`UpcItemDb fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  private normalize(item: UpcItemDbItem, barcode: string): NormalizedFood | null {
    const name = (item.title || '').trim();
    if (!name) return null;

    return {
      canonicalName: name.toLowerCase(),
      displayName: name,
      aliases: [],
      brand: (item.brand || '').trim() || null,
      barcode: (item.ean || barcode).trim(),
      category: this.mapCategory(item.category),
      servingOptions: [{ label: '100 g', grams: 100, isDefault: true }],
      per100g: {
        kcal: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        fiber_g: 0,
        sugar_g: 0,
        sodium_mg: 0,
      },
      source: FoodSource.AI, 
      confidence: 0.3,
      verified: false,
      locale: 'global',
    };
  }

  private mapCategory(cat: string): FoodCategory {
    if (!cat) return FoodCategory.OTHER;
    const lower = cat.toLowerCase();
    if (lower.includes('beverage') || lower.includes('drink')) return FoodCategory.BEVERAGE;
    if (lower.includes('snack') || lower.includes('chip')) return FoodCategory.SNACK;
    if (lower.includes('dairy') || lower.includes('milk') || lower.includes('cheese')) return FoodCategory.DAIRY;
    if (lower.includes('cereal') || lower.includes('grain') || lower.includes('bread')) return FoodCategory.GRAIN;
    if (lower.includes('candy') || lower.includes('chocolate') || lower.includes('sweet')) return FoodCategory.SWEET;
    if (lower.includes('sauce') || lower.includes('condiment') || lower.includes('spice')) return FoodCategory.CONDIMENT;
    if (lower.includes('meat') || lower.includes('chicken') || lower.includes('fish')) return FoodCategory.PROTEIN;
    if (lower.includes('fruit')) return FoodCategory.FRUIT;
    if (lower.includes('vegetable')) return FoodCategory.VEGETABLE;
    if (lower.includes('oil') || lower.includes('butter')) return FoodCategory.FAT_OIL;
    return FoodCategory.PACKAGED;
  }
}
