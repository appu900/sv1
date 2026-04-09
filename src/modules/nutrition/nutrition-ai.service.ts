import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { getCuisineContext } from '../../common/utils/country-cuisine.util';

export interface AiNutritionEstimate {
  foodDescription: string;
  servingLabel: string;
  servingGrams: number;
  perServing: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sugar_g: number;
    sodium_mg: number;
  };
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

@Injectable()
export class NutritionAiService {
  private readonly logger = new Logger(NutritionAiService.name);
  constructor(
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI | null,
  ) {
    if (!this.openai) {
      this.logger.warn('OPENAI_API_KEY not set — AI nutrition estimation disabled');
    }
  }

  async estimateNutrition(
    foodDescription: string,
    servingLabel?: string,
    servingGrams?: number,
    country?: string,
  ): Promise<AiNutritionEstimate> {
    if (!this.openai) {
      throw new ServiceUnavailableException('AI estimation is not available — OPENAI_API_KEY is not configured');
    }

    this.logger.log(`AI estimating nutrition for: "${foodDescription}"`);

    const servingContext = servingLabel
      ? `Serving described as: "${servingLabel}"${servingGrams ? ` (~${servingGrams}g)` : ''}`
      : 'No serving size specified — use a typical single serving.';

    const ctx = getCuisineContext(country);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a nutrition estimation engine for Saveful, a global food tracking app.
The user is located in ${ctx.countryName}. Given a food description and a serving size, estimate the nutritional content as accurately as possible.

RULES:
1. Use ${ctx.nutritionDatabases} and established nutrition databases as reference.
2. Account for ${ctx.cookingContext} when relevant to the dish.
3. If the food is ambiguous, choose the most common preparation in ${ctx.countryName}.
4. All values are PER SERVING, not per 100g.
5. Be conservative — slightly overestimate calories rather than underestimate.
6. Set confidence: "high" for well-known single ingredients, "medium" for common dishes, "low" for unusual or complex items.

Respond ONLY with valid JSON, no markdown, no explanation.`,
        },
        {
          role: 'user',
          content: `Estimate the nutrition for: "${foodDescription}"
${servingContext}

Return JSON:
{
  "foodDescription": "cleaned/normalized food name",
  "servingLabel": "e.g. 1 medium bowl, 1 piece, 1 cup",
  "servingGrams": 250,
  "perServing": {
    "kcal": 350,
    "protein_g": 12,
    "carbs_g": 45,
    "fat_g": 14,
    "fiber_g": 4,
    "sugar_g": 6,
    "sodium_mg": 480
  },
  "confidence": "medium",
  "source": "AI estimate based on ${ctx.nutritionDatabases} references"
}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response');
    }

    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    const parsed: AiNutritionEstimate = JSON.parse(cleanContent);

    parsed.perServing.kcal = Math.max(0, Math.min(5000, parsed.perServing.kcal));
    parsed.perServing.protein_g = Math.max(0, Math.min(500, parsed.perServing.protein_g));
    parsed.perServing.carbs_g = Math.max(0, Math.min(500, parsed.perServing.carbs_g));
    parsed.perServing.fat_g = Math.max(0, Math.min(500, parsed.perServing.fat_g));
    parsed.perServing.fiber_g = Math.max(0, Math.min(200, parsed.perServing.fiber_g));
    parsed.perServing.sugar_g = Math.max(0, Math.min(500, parsed.perServing.sugar_g));
    parsed.perServing.sodium_mg = Math.max(0, Math.min(10000, parsed.perServing.sodium_mg));

    this.logger.log(
      `AI estimate for "${foodDescription}": ${parsed.perServing.kcal} kcal, confidence=${parsed.confidence}`,
    );

    return parsed;
  }

  async estimateIngredientBreakdown(
    ingredients: { name: string; quantity: string; preparation: string }[],
    country?: string,
  ): Promise<
    { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sodium_mg: number }[]
  > {
    if (!this.openai) {
      throw new ServiceUnavailableException('AI estimation is not available — OPENAI_API_KEY is not configured');
    }

    const list = ingredients
      .map((i, idx) => `${idx + 1}. ${i.quantity} ${i.name} (${i.preparation})`)
      .join('\n');

    this.logger.log(`AI estimating ingredient breakdown for ${ingredients.length} items`);

    const ctx = getCuisineContext(country);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a nutrition estimation engine. Given a numbered list of recipe ingredients with quantities, estimate the nutrition for EACH ingredient separately.

RULES:
1. Use ${ctx.nutritionDatabases} as reference.
2. Account for ${ctx.cookingContext} when relevant.
3. Each entry is the nutrition for that ingredient at the given quantity.
4. Be conservative — slightly overestimate rather than underestimate.

Respond ONLY with a valid JSON array, no markdown, no explanation. The array must have exactly the same number of elements as ingredients listed.`,
        },
        {
          role: 'user',
          content: `Estimate per-ingredient nutrition:\n${list}\n\nReturn JSON array:\n[\n  { "kcal": 120, "protein_g": 3, "carbs_g": 20, "fat_g": 4, "fiber_g": 2, "sugar_g": 1, "sodium_mg": 50 },\n  ...\n]`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('AI returned empty response');

    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed: any[] = JSON.parse(clean);

    // Validate & clamp each entry
    return parsed.map((item) => ({
      kcal: Math.max(0, Math.min(5000, item?.kcal ?? 0)),
      protein_g: Math.max(0, Math.min(500, item?.protein_g ?? 0)),
      carbs_g: Math.max(0, Math.min(500, item?.carbs_g ?? 0)),
      fat_g: Math.max(0, Math.min(500, item?.fat_g ?? 0)),
      fiber_g: Math.max(0, Math.min(200, item?.fiber_g ?? 0)),
      sugar_g: Math.max(0, Math.min(500, item?.sugar_g ?? 0)),
      sodium_mg: Math.max(0, Math.min(10000, item?.sodium_mg ?? 0)),
    }));
  }
}
