import { Inject, Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { FoodSource } from '../../database/schemas/nutrition/food-item.schema';
import { NormalizedFood } from './providers/open-food-facts.provider';

export interface ProductImageAnalysis {
  productName: string;
  brand: string | null;
  barcode: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  per100g: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    sodium_mg: number;
  };
  confidence: 'high' | 'medium' | 'low';
  category: string;
}

@Injectable()
export class ProductImageAnalysisService {
  private readonly logger = new Logger(ProductImageAnalysisService.name);

  constructor(
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI | null,
  ) {}

  /**
   * Build image content parts for OpenAI Vision from provided images.
   * Each image is labeled so the AI knows which photo is which.
   */
  private buildImageParts(
    images: { label: string; base64: string; mimeType: string }[],
  ): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' | 'low' } }> {
    const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' | 'low' } }> = [];
    for (const img of images) {
      parts.push({ type: 'text', text: `[${img.label}]` });
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: 'high',
        },
      });
    }
    return parts;
  }

  /**
   * Analyze product images using OpenAI Vision.
   * Accepts 1–3 specialized images for higher accuracy:
   *  - barcode: close-up of the barcode
   *  - nutrition: close-up of the nutrition facts label
   *  - front: product front / name / packaging
   *
   * Falls back gracefully if fewer images are provided.
   */
  async analyzeProductImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<ProductImageAnalysis>;
  async analyzeProductImage(
    images: { barcode?: { base64: string; mimeType: string }; nutrition?: { base64: string; mimeType: string }; front?: { base64: string; mimeType: string } },
  ): Promise<ProductImageAnalysis>;
  async analyzeProductImage(
    imageOrImages: string | { barcode?: { base64: string; mimeType: string }; nutrition?: { base64: string; mimeType: string }; front?: { base64: string; mimeType: string } },
    mimeType?: string,
  ): Promise<ProductImageAnalysis> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'AI image analysis is not available — OPENAI_API_KEY is not configured',
      );
    }

    // Normalize: single image (legacy) → multi-image format
    let imageParts: Array<{ label: string; base64: string; mimeType: string }>;
    let imageCount: number;

    if (typeof imageOrImages === 'string') {
      // Legacy single-image call
      imageParts = [{ label: 'Product Photo', base64: imageOrImages, mimeType: mimeType! }];
      imageCount = 1;
    } else {
      imageParts = [];
      if (imageOrImages.barcode) {
        imageParts.push({ label: 'Barcode (close-up)', ...imageOrImages.barcode });
      }
      if (imageOrImages.nutrition) {
        imageParts.push({ label: 'Nutrition Facts Label', ...imageOrImages.nutrition });
      }
      if (imageOrImages.front) {
        imageParts.push({ label: 'Product Front / Packaging', ...imageOrImages.front });
      }
      imageCount = imageParts.length;
      if (imageCount === 0) {
        throw new BadRequestException('At least one product image is required');
      }
    }

    this.logger.log(`Analyzing product with ${imageCount} image(s) via AI Vision...`);

    const multiImageHint = imageCount > 1
      ? `You will receive ${imageCount} labeled photos of the SAME product, each showing a different aspect. Cross-reference all images to produce the most accurate result.`
      : 'You will receive a single photo of a food product — it could be the packaging, nutrition label, or both.';

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a product nutrition analyzer for Saveful, a food tracking app.
${multiImageHint}

Your task:
1. Identify the product name and brand. Use the "Product Front / Packaging" image if available.
2. Extract nutrition information (per 100g). Use the "Nutrition Facts Label" image if available. If the label shows per serving, convert to per 100g.
3. Read the barcode digits from the "Barcode (close-up)" image if available.
4. Determine the food category.

RULES:
- All nutrition values MUST be per 100g, not per serving.
- If you can read values directly from a clear nutrition label image, set confidence to "high".
- If you're estimating some values, set confidence to "medium".
- If the images are unclear and you're mostly guessing, set confidence to "low".
- If serving size is visible, include it.
- For barcode: only return it if you can clearly read the digits. Otherwise null.
- Category must be one of: fruit, vegetable, grain, legume, dairy, protein, fat_oil, beverage, snack, sweet, packaged, dish, condiment, other.
- Be conservative: slightly overestimate calories rather than underestimate.
- Cross-reference product name, brand, and nutrition across all provided images for consistency.

Respond ONLY with valid JSON, no markdown, no explanation.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this food product. Extract the product name, brand, nutrition info (per 100g), barcode if visible, and category.

Return JSON:
{
  "productName": "Product Name",
  "brand": "Brand Name or null",
  "barcode": "1234567890123 or null",
  "servingSize": "30g or null",
  "servingGrams": 30,
  "per100g": {
    "kcal": 350,
    "protein_g": 12,
    "carbs_g": 45,
    "fat_g": 14,
    "fiber_g": 4,
    "sugar_g": 6,
    "sodium_mg": 480
  },
  "confidence": "medium",
  "category": "packaged"
}`,
            },
            ...this.buildImageParts(imageParts),
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new ServiceUnavailableException('AI returned empty response for product image analysis');
    }

    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    let parsed: ProductImageAnalysis;
    try {
      parsed = JSON.parse(cleanContent);
    } catch {
      this.logger.error(`AI returned malformed JSON for product image: ${cleanContent.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned malformed response');
    }

    // Clamp & sanitize nutrition values
    parsed.per100g.kcal = this.clamp(parsed.per100g.kcal, 0, 9000);
    parsed.per100g.protein_g = this.clamp(parsed.per100g.protein_g, 0, 100);
    parsed.per100g.carbs_g = this.clamp(parsed.per100g.carbs_g, 0, 100);
    parsed.per100g.fat_g = this.clamp(parsed.per100g.fat_g, 0, 100);
    parsed.per100g.fiber_g = this.clamp(parsed.per100g.fiber_g, 0, 100);
    parsed.per100g.sugar_g = this.clamp(parsed.per100g.sugar_g, 0, 100);
    parsed.per100g.sodium_mg = this.clamp(parsed.per100g.sodium_mg, 0, 10000);

    // Sanitize barcode — only allow valid digit strings
    if (parsed.barcode && !/^\d{6,14}$/.test(parsed.barcode.trim())) {
      parsed.barcode = null;
    } else if (parsed.barcode) {
      parsed.barcode = parsed.barcode.trim();
    }

    // Sanitize product name
    if (!parsed.productName || parsed.productName.trim().length === 0) {
      throw new BadRequestException('AI could not identify the product name from the image');
    }
    parsed.productName = parsed.productName.trim();

    this.logger.log(
      `Product image analysis: "${parsed.productName}" (${parsed.brand ?? 'no brand'}), ` +
        `${parsed.per100g.kcal} kcal/100g, confidence=${parsed.confidence}`,
    );

    return parsed;
  }

  /**
   * Convert the AI analysis result into a NormalizedFood for DB storage.
   */
  analysisToNormalizedFood(
    analysis: ProductImageAnalysis,
    imageUrl: string | null,
  ): NormalizedFood & { imageUrl?: string } {
    const servingOptions: { label: string; grams: number; isDefault?: boolean }[] = [
      { label: '100 g', grams: 100, isDefault: true },
    ];

    if (analysis.servingGrams && analysis.servingGrams > 0 && analysis.servingGrams !== 100) {
      servingOptions.push({
        label: analysis.servingSize ?? `${analysis.servingGrams} g`,
        grams: analysis.servingGrams,
      });
    }

    const confidenceScore =
      analysis.confidence === 'high' ? 0.85 :
      analysis.confidence === 'medium' ? 0.65 : 0.4;

    return {
      canonicalName: analysis.productName.toLowerCase(),
      displayName: analysis.productName,
      aliases: [],
      brand: analysis.brand || null,
      barcode: analysis.barcode || null,
      category: (analysis.category || 'packaged') as any,
      servingOptions,
      per100g: analysis.per100g,
      source: FoodSource.AI,
      confidence: confidenceScore,
      verified: false,
      locale: 'in',
      ...(imageUrl ? { imageUrl } : {}),
    };
  }

  private clamp(value: number | undefined | null, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(min, Math.min(max, n));
  }
}
