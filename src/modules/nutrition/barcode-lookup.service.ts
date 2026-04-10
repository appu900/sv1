import { Injectable, Logger } from '@nestjs/common';
import { OpenFoodFactsProvider, NormalizedFood } from './providers/open-food-facts.provider';
import { UpcItemDbProvider } from './providers/upc-itemdb.provider';
import { NutritionAiService } from './nutrition-ai.service';
import { FoodItemService } from './food-item.service';
import { FoodSource } from '../../database/schemas/nutrition/food-item.schema';

const OFF_INDIA_BASE = 'https://in.openfoodfacts.org';

@Injectable()
export class BarcodeLookupService {
  private readonly logger = new Logger(BarcodeLookupService.name);

  constructor(
    private readonly foodItemService: FoodItemService,
    private readonly openFoodFacts: OpenFoodFactsProvider,
    private readonly upcItemDb: UpcItemDbProvider,
    private readonly nutritionAi: NutritionAiService,
  ) {}

  async lookup(barcode: string): Promise<{
    source: string;
    item: any;
  } | null> {
    // 1. Check local DB cache
    const cached = await this.foodItemService.findByBarcode(barcode);
    if (cached) {
      this.logger.log(`Barcode ${barcode} found in local DB cache`);
      return { source: 'cache', item: cached };
    }

    // 2. Open Food Facts — world
    this.logger.log(`Barcode ${barcode} not cached, trying OFF world...`);
    const offWorld = await this.openFoodFacts.fetchByBarcode(barcode);
    if (offWorld && offWorld.per100g.kcal > 0) {
      this.logger.log(`Barcode ${barcode} found on OFF world`);
      try {
        const saved = await this.foodItemService.upsert(offWorld);
        return { source: 'openfoodfacts', item: saved };
      } catch (e) {
        this.logger.warn(`Upsert failed for OFF world barcode ${barcode}: ${(e as Error).message}`);
        return { source: 'openfoodfacts', item: offWorld };
      }
    }

    // 3. Open Food Facts — India endpoint (separate DB, more Indian products)
    this.logger.log(`Trying OFF India for barcode ${barcode}...`);
    const offIndia = await this.fetchFromOffIndia(barcode);
    if (offIndia && offIndia.per100g.kcal > 0) {
      this.logger.log(`Barcode ${barcode} found on OFF India`);
      try {
        const saved = await this.foodItemService.upsert(offIndia);
        return { source: 'openfoodfacts-india', item: saved };
      } catch (e) {
        this.logger.warn(`Upsert failed for OFF India barcode ${barcode}: ${(e as Error).message}`);
        return { source: 'openfoodfacts-india', item: offIndia };
      }
    }

    // 4. UPC Item DB — product identification only (no nutrition)
    this.logger.log(`Trying UPC Item DB for barcode ${barcode}...`);
    const upcItem = await this.upcItemDb.fetchByBarcode(barcode);
    if (upcItem && upcItem.displayName) {
      this.logger.log(`Barcode ${barcode} found on UPC Item DB: "${upcItem.displayName}"`);

      // Use AI to estimate nutrition for the identified product
      const enriched = await this.enrichWithAi(upcItem);
      if (enriched) {
        try {
          const saved = await this.foodItemService.upsert(enriched);
          return { source: 'upcitemdb+ai', item: saved };
        } catch (e) {
          this.logger.warn(`Upsert failed for UPC+AI barcode ${barcode}: ${(e as Error).message}`);
          return { source: 'upcitemdb+ai', item: enriched };
        }
      }

      // If AI fails, still save the basic product info
      try {
        const saved = await this.foodItemService.upsert(upcItem);
        return { source: 'upcitemdb', item: saved };
      } catch (e) {
        this.logger.warn(`Upsert failed for UPC barcode ${barcode}: ${(e as Error).message}`);
        return { source: 'upcitemdb', item: upcItem };
      }
    }

    this.logger.warn(`Barcode ${barcode} not found in any source`);
    return null;
  }

  /**
   * Fetch from India-specific OFF endpoint.
   * This uses the same API format as world OFF but with in.openfoodfacts.org.
   */
  private async fetchFromOffIndia(barcode: string): Promise<NormalizedFood | null> {
    for (const code of this.barcodeVariants(barcode)) {
      const result = await this.fetchSingleFromOff(OFF_INDIA_BASE, code);
      if (result) return result;
    }
    return null;
  }

  private async fetchSingleFromOff(
    base: string,
    barcode: string,
  ): Promise<NormalizedFood | null> {
    const url = `${base}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,product_name_en,generic_name,brands,categories_tags,countries_tags,serving_quantity,serving_size,nutriments,completeness`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SavefulNutrition/1.0 (https://saveful.app; contact@saveful.app)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 0 || !data.product) return null;

      // Reuse the OFF provider's normalization via a minimal inline normalize
      return this.normalizeOffProduct(data.product);
    } catch (err) {
      this.logger.warn(`OFF India fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  private normalizeOffProduct(p: any): NormalizedFood | null {
    const n = p.nutriments ?? {};

    let kcal = this.numeric(n['energy-kcal_100g'] ?? n['energy-kcal']);
    if (kcal === null) {
      const kj = this.numeric(n['energy-kj_100g'] ?? n['energy-kj'] ?? n.energy_100g ?? n.energy);
      if (kj !== null) kcal = Math.round(kj / 4.184);
    }
    if (kcal === null) return null;

    const name = (p.product_name_en || p.product_name || p.generic_name || '').trim();
    if (!name) return null;

    const sodium_mg =
      this.numeric(n.sodium_100g) !== null
        ? (this.numeric(n.sodium_100g) as number) * 1000
        : this.numeric(n.salt_100g) !== null
          ? ((this.numeric(n.salt_100g) as number) * 1000) / 2.5
          : 0;

    const servingOptions: NormalizedFood['servingOptions'] = [
      { label: '100 g', grams: 100, isDefault: true },
    ];
    const servingGrams = this.numeric(p.serving_quantity);
    if (servingGrams && servingGrams > 0 && servingGrams !== 100) {
      servingOptions.push({
        label: p.serving_size?.trim() || `${servingGrams} g`,
        grams: servingGrams,
      });
    }

    return {
      canonicalName: name.toLowerCase(),
      displayName: name,
      aliases: [],
      brand: (p.brands?.split(',')[0] || '').trim() || null,
      barcode: (p.code || '').trim() || null,
      category: 'packaged' as any,
      servingOptions,
      per100g: {
        kcal,
        protein_g: this.numeric(n.proteins_100g) ?? 0,
        carbs_g: this.numeric(n.carbohydrates_100g) ?? 0,
        fat_g: this.numeric(n.fat_100g) ?? 0,
        fiber_g: this.numeric(n.fiber_100g) ?? 0,
        sugar_g: this.numeric(n.sugars_100g) ?? 0,
        sodium_mg,
      },
      source: FoodSource.OPEN_FOOD_FACTS,
      confidence: Math.min(Math.max((p.completeness ?? 0.6) * 0.9, 0.3), 0.9),
      verified: false,
      locale: 'in',
    };
  }

  /**
   * Use AI to estimate nutrition for a product found via UPC Item DB.
   */
  private async enrichWithAi(product: NormalizedFood): Promise<NormalizedFood | null> {
    try {
      const desc = product.brand
        ? `${product.displayName} by ${product.brand}`
        : product.displayName;

      const estimate = await this.nutritionAi.estimateNutrition(desc, '100g', 100);

      return {
        ...product,
        per100g: {
          kcal: estimate.perServing.kcal,
          protein_g: estimate.perServing.protein_g,
          carbs_g: estimate.perServing.carbs_g,
          fat_g: estimate.perServing.fat_g,
          fiber_g: estimate.perServing.fiber_g,
          sugar_g: estimate.perServing.sugar_g,
          sodium_mg: estimate.perServing.sodium_mg,
        },
        source: FoodSource.AI,
        confidence: estimate.confidence === 'high' ? 0.8 : estimate.confidence === 'medium' ? 0.6 : 0.4,
      };
    } catch (err) {
      this.logger.warn(`AI enrichment failed for "${product.displayName}": ${(err as Error).message}`);
      return null;
    }
  }

  private barcodeVariants(barcode: string): string[] {
    const variants = [barcode];
    if (barcode.length === 12) variants.push('0' + barcode);
    if (barcode.length === 13 && barcode.startsWith('0')) variants.push(barcode.slice(1));
    if (barcode.length < 13) {
      const padded = barcode.padStart(13, '0');
      if (!variants.includes(padded)) variants.push(padded);
    }
    return variants;
  }

  private numeric(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }
}
