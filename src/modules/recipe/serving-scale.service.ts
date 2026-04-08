import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import OpenAI from 'openai';
import { RedisService } from '../../redis/redis.service';
import {
  ScaleServingsDto,
  ScaleServingsResponseDto,
  ScaledIngredientResult,
} from './dto/scale-servings.dto';
import {
  ScaledPortionsCache,
  ScaledPortionsCacheDocument,
} from '../../database/schemas/scaled-portions-cache.schema';

@Injectable()
export class ServingScaleService {
  private readonly logger = new Logger(ServingScaleService.name);
  private readonly openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  private readonly CACHE_TTL = 86400;
  private readonly CACHE_PREFIX = 'serving-scale';

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(ScaledPortionsCache.name)
    private readonly scaledCacheModel: Model<ScaledPortionsCacheDocument>,
  ) {}

 
  async scaleServings(
    dto: ScaleServingsDto,
  ): Promise<ScaleServingsResponseDto> {
    const { desiredServings, originalServings, ingredients, recipeTitle } = dto;

    if (desiredServings === originalServings) {
      return {
        originalServings,
        desiredServings,
        scaledIngredients: ingredients.map((ing) => ({
          ingredientName: ing.ingredientName,
          originalQuantity: ing.originalQuantity,
          scaledQuantity: ing.originalQuantity,
          ingredientId: ing.ingredientId,
          preparation: ing.preparation,
        })),
      };
    }

    const cacheKey = this.buildCacheKey(dto);

    // 1. Check Redis (fast, short-lived)
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.debug('Serving scale Redis cache hit');
        return JSON.parse(cached);
      }
    } catch (e) {
      this.logger.warn('Redis read failed for serving scale:', e?.message);
    }

    // 2. Check MongoDB (permanent — AI is never called twice for the same combo)
    try {
      const mongoDoc = await this.scaledCacheModel.findOne({ cacheKey }).lean().exec();
      if (mongoDoc) {
        this.logger.debug('Serving scale MongoDB cache hit');
        const result = mongoDoc.result as unknown as ScaleServingsResponseDto;
        // Backfill Redis so subsequent hits within the TTL window are even faster
        this.redisService.set(cacheKey, JSON.stringify(result), this.CACHE_TTL).catch(() => null);
        return result;
      }
    } catch (e) {
      this.logger.warn('MongoDB read failed for serving scale:', e?.message);
    }

    // 3. Call AI and persist to both stores
    try {
      const result = await this.scaleWithAI(dto);
      // Persist to MongoDB (permanent)
      this.scaledCacheModel
        .create({
          cacheKey,
          recipeId: dto.recipeId,
          originalServings: dto.originalServings,
          desiredServings: dto.desiredServings,
          result: result as unknown as Record<string, unknown>,
        })
        .catch((e) => this.logger.warn('MongoDB write failed for serving scale:', e?.message));
      // Persist to Redis (fast layer)
      this.redisService
        .set(cacheKey, JSON.stringify(result), this.CACHE_TTL)
        .catch((e) => this.logger.warn('Redis write failed for serving scale:', e?.message));
      return result;
    } catch (error) {
      this.logger.error('AI scaling failed, falling back to simple math:', error?.message);
      return this.scaleWithSimpleMath(dto);
    }
  }

  private async scaleWithAI(
    dto: ScaleServingsDto,
  ): Promise<ScaleServingsResponseDto> {
    const { desiredServings, originalServings, ingredients, recipeTitle } = dto;
    const scaleFactor = desiredServings / originalServings;

    const ingredientList = ingredients
      .map(
        (ing, i) =>
          `${i + 1}. "${ing.ingredientName}" — quantity: "${ing.originalQuantity}"${ing.preparation ? ` (prep: ${ing.preparation})` : ''}`,
      )
      .join('\n');

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a professional chef assistant that scales recipe ingredient quantities intelligently. You MUST respond ONLY in valid JSON, no markdown, no explanation outside JSON.

Rules for scaling:
1. Scale quantities proportionally based on the ratio (desiredServings / originalServings = ${scaleFactor.toFixed(2)}).
2. Use human-friendly measurements — prefer fractions (½, ¼, ¾) over decimals.
3. Round to practical cooking amounts (e.g., "1¼ cups" not "1.25 cups").
4. Seasonings/spices should scale slightly less than proportionally for large multipliers.
5. Items that don't scale (e.g., "a pinch of salt", "to taste") should remain unchanged.
6. Keep the same unit system as the original (metric stays metric, imperial stays imperial).
7. If the original quantity is descriptive (e.g., "1 medium onion"), adapt it naturally (e.g., "2 medium onions" for 2x).
8. For very small quantities when scaling down, suggest the minimum practical amount.`,
        },
        {
          role: 'user',
          content: `Scale this recipe${recipeTitle ? ` "${recipeTitle}"` : ''} from ${originalServings} servings to ${desiredServings} servings.

Ingredients:
${ingredientList}

Return JSON:
{
  "scaledIngredients": [
    {
      "index": 1,
      "ingredientName": "...",
      "originalQuantity": "...",
      "scaledQuantity": "..."
    }
  ],
  "cookingNotes": "optional brief note about adjustments for this serving size, or null"
}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response');
    }

    // Parse AI response - strip markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleanContent);
    } catch (parseError) {
      this.logger.error('Failed to parse AI response:', cleanContent);
      throw new Error(`AI response parse error: ${parseError.message}`);
    }

    const scaledIngredients: ScaledIngredientResult[] = ingredients.map(
      (ing, index) => {
        const aiResult = parsed.scaledIngredients?.find(
          (r: any) => r.index === index + 1,
        );
        return {
          ingredientName: ing.ingredientName,
          originalQuantity: ing.originalQuantity,
          scaledQuantity: aiResult?.scaledQuantity || ing.originalQuantity,
          ingredientId: ing.ingredientId,
          preparation: ing.preparation,
        };
      },
    );

    return {
      originalServings,
      desiredServings,
      scaledIngredients,
      cookingNotes: parsed.cookingNotes || undefined,
    };
  }

  private scaleWithSimpleMath(
    dto: ScaleServingsDto,
  ): ScaleServingsResponseDto {
    const { desiredServings, originalServings, ingredients } = dto;
    const ratio = desiredServings / originalServings;

    const scaledIngredients: ScaledIngredientResult[] = ingredients.map(
      (ing) => ({
        ingredientName: ing.ingredientName,
        originalQuantity: ing.originalQuantity,
        scaledQuantity: this.scaleQuantityString(ing.originalQuantity, ratio),
        ingredientId: ing.ingredientId,
        preparation: ing.preparation,
      }),
    );

    return {
      originalServings,
      desiredServings,
      scaledIngredients,
    };
  }


  private scaleQuantityString(quantity: string, ratio: number): string {
    if (!quantity || quantity.trim() === '') return quantity;

    const trimmed = quantity.trim().toLowerCase();

    const nonScalable = ['to taste', 'a pinch', 'as needed', 'optional', 'a dash', 'a splash'];
    if (nonScalable.some((ns) => trimmed.includes(ns))) {
      return quantity;
    }

    const match = trimmed.match(
      /^(\d+(?:\.\d+)?(?:\s*[½¼¾⅓⅔⅛⅜⅝⅞])?(?:\s*\/\s*\d+)?)\s*(.*)/,
    );

    if (match) {
      let numStr = match[1].trim();
      const rest = match[2];

      const fractionMap: Record<string, number> = {
        '½': 0.5, '¼': 0.25, '¾': 0.75,
        '⅓': 1 / 3, '⅔': 2 / 3,
        '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
      };

      let numValue = 0;
      for (const [frac, val] of Object.entries(fractionMap)) {
        if (numStr.includes(frac)) {
          const intPart = numStr.replace(frac, '').trim();
          numValue = (intPart ? parseFloat(intPart) : 0) + val;
          break;
        }
      }

      if (numValue === 0) {
        if (numStr.includes('/')) {
          const parts = numStr.split('/');
          numValue = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else {
          numValue = parseFloat(numStr);
        }
      }

      if (!isNaN(numValue)) {
        const scaled = numValue * ratio;
        const rounded = this.smartRound(scaled);
        return `${rounded}${rest ? ' ' + rest : ''}`;
      }
    }

    return quantity;
  }

  
  private smartRound(n: number): string {
    if (n <= 0) return '0';

    if (Math.abs(n - Math.round(n)) < 0.05) {
      return Math.round(n).toString();
    }

    const fractions: [number, string][] = [
      [0.25, '¼'], [0.33, '⅓'], [0.5, '½'],
      [0.67, '⅔'], [0.75, '¾'],
    ];

    const whole = Math.floor(n);
    const frac = n - whole;

    for (const [val, symbol] of fractions) {
      if (Math.abs(frac - val) < 0.08) {
        return whole > 0 ? `${whole}${symbol}` : symbol;
      }
    }

    const rounded = Math.round(n * 10) / 10;
    return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
  }

  private buildCacheKey(dto: ScaleServingsDto): string {
    const normalizedPayload = {
      recipeId: dto.recipeId?.trim() || '',
      recipeTitle: dto.recipeTitle?.trim().toLowerCase() || '',
      originalServings: dto.originalServings,
      desiredServings: dto.desiredServings,
      ingredients: dto.ingredients
        .map((ingredient) => ({
          ingredientId: ingredient.ingredientId?.trim() || '',
          ingredientName: ingredient.ingredientName.trim().toLowerCase(),
          originalQuantity: ingredient.originalQuantity.trim().toLowerCase(),
          preparation: ingredient.preparation?.trim().toLowerCase() || '',
        }))
        .sort((left, right) =>
          `${left.ingredientId}:${left.ingredientName}:${left.originalQuantity}:${left.preparation}`.localeCompare(
            `${right.ingredientId}:${right.ingredientName}:${right.originalQuantity}:${right.preparation}`,
          ),
        ),
    };

    const payloadHash = createHash('sha256')
      .update(JSON.stringify(normalizedPayload))
      .digest('hex');

    return `${this.CACHE_PREFIX}:${payloadHash}`;
  }
}
