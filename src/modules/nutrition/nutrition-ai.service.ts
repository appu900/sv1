import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { getCuisineContext } from '../../common/utils/country-cuisine.util';

export interface NutritionValues {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

export interface AiNutritionEstimate {
  foodDescription: string;
  servingLabel: string;
  servingGrams: number;
  perServing: NutritionValues;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export interface PhotoFoodAnalysis {
  foods: {
    name: string;
    servingLabel: string;
    servingGrams: number;
    perServing: NutritionValues;
  }[];
  totalPerServing: NutritionValues;
  primaryFoodName: string;
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
      throw new ServiceUnavailableException('AI returned empty response');
    }

    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    let parsed: AiNutritionEstimate;
    try {
      parsed = JSON.parse(cleanContent);
    } catch {
      this.logger.error(`AI returned malformed JSON for estimateNutrition: ${cleanContent.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned malformed response');
    }

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

  /**
   * Identify food items from a photo and return search-friendly names.
   */
  async identifyFoodFromImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<{ foods: string[]; primaryFood: string }> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'AI food identification is not available — OPENAI_API_KEY is not configured',
      );
    }

    this.logger.log('Identifying food from image with AI Vision...');

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a food identification engine for Saveful, a food tracking app used in India.
Given a photo of food, identify what food items are visible.

RULES:
1. Return simple, common food names that would match a nutrition database search.
2. Use the most widely recognized name (e.g. "paneer butter masala" not "shahi paneer makhani").
3. If multiple distinct foods are visible, list each separately.
4. The "primaryFood" should be the most prominent/main item.
5. Keep names short and searchable — no long descriptions.
6. For Indian foods, use common English transliterations (e.g. "dal tadka", "roti", "biryani").
7. If you see a packaged product, return the product name.
8. If the image is unclear or not food, return an empty foods array.

Respond ONLY with valid JSON, no markdown, no explanation.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Identify the food items in this photo.

Return JSON:
{
  "foods": ["paneer butter masala", "naan", "rice"],
  "primaryFood": "paneer butter masala"
}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new ServiceUnavailableException('AI returned empty response for food identification');
    }

    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      this.logger.error(`AI returned malformed JSON for identifyFood: ${clean.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned malformed response');
    }

    const foods: string[] = Array.isArray(parsed.foods)
      ? parsed.foods
          .filter((f: unknown) => typeof f === 'string' && f.trim().length > 0)
          .map((f: string) => f.trim().slice(0, 100))
          .slice(0, 10)
      : [];
    const primaryFood: string =
      typeof parsed.primaryFood === 'string' && parsed.primaryFood.trim().length > 0
        ? parsed.primaryFood.trim().slice(0, 100)
        : foods[0] ?? '';

    this.logger.log(
      `Food identification: primary="${primaryFood}", all=[${foods.join(', ')}]`,
    );

    return { foods, primaryFood };
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
    if (!content) throw new ServiceUnavailableException('AI returned empty response');

    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: any[];
    try {
      parsed = JSON.parse(clean);
    } catch {
      this.logger.error(`AI returned malformed JSON for ingredientBreakdown: ${clean.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned malformed response');
    }

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

  /**
   * Analyze a food photo combined with optional user-provided details
   * and return a complete nutrition estimate for every visible food item.
   */
  async analyzeAndEstimateFoodFromPhoto(
    imageBase64: string,
    mimeType: string,
    userDescription?: string,
    servingLabel?: string,
    servingGrams?: number,
    country?: string,
  ): Promise<PhotoFoodAnalysis> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'AI food analysis is not available — OPENAI_API_KEY is not configured',
      );
    }

    this.logger.log(
      `Photo quick-add analysis${userDescription ? ` (hint: "${userDescription}")` : ''}`,
    );

    const ctx = getCuisineContext(country);

    const userHints: string[] = [];
    if (userDescription) {
      userHints.push(`User says this is: "${userDescription}"`);
    }
    if (servingLabel) {
      userHints.push(`Serving described as: "${servingLabel}"${servingGrams ? ` (~${servingGrams}g)` : ''}`);
    } else if (servingGrams) {
      userHints.push(`Serving size: ~${servingGrams}g`);
    }
    const hintsBlock = userHints.length
      ? `\n\nADDITIONAL CONTEXT FROM USER:\n${userHints.join('\n')}`
      : '';

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a food recognition and nutrition estimation engine for Saveful, a food tracking app.
The user is located in ${ctx.countryName}. Given a photo of food (and optionally a text description), you MUST:
1. Identify every distinct food item visible in the photo.
2. Estimate the COMPLETE nutrition for each item PER SERVING (what is visible on the plate/bowl/container).
3. Compute a total across all items.

RULES:
- Use ${ctx.nutritionDatabases} and established nutrition databases as reference.
- Account for ${ctx.cookingContext} when relevant.
- If the user provides a description, trust it over your visual identification when they conflict.
- If serving size is not provided by the user, estimate from what's visible in the photo.
- All values are PER SERVING (the amount visible), NOT per 100g.
- Be conservative — slightly overestimate calories rather than underestimate.
- Set confidence: "high" for clearly identifiable single items, "medium" for common dishes, "low" for unclear images or complex multi-item plates.
- Use simple, common food names suitable for database search.
- For Indian foods use common English transliterations (e.g. "dal tadka", "roti", "biryani").

Respond ONLY with valid JSON, no markdown, no explanation.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Identify and estimate nutrition for the food in this photo.${hintsBlock}

Return JSON:
{
  "foods": [
    {
      "name": "paneer butter masala",
      "servingLabel": "1 medium bowl",
      "servingGrams": 250,
      "perServing": { "kcal": 380, "protein_g": 18, "carbs_g": 12, "fat_g": 28, "fiber_g": 2, "sugar_g": 4, "sodium_mg": 680 }
    },
    {
      "name": "naan",
      "servingLabel": "1 piece",
      "servingGrams": 90,
      "perServing": { "kcal": 260, "protein_g": 7, "carbs_g": 42, "fat_g": 7, "fiber_g": 2, "sugar_g": 3, "sodium_mg": 400 }
    }
  ],
  "totalPerServing": { "kcal": 640, "protein_g": 25, "carbs_g": 54, "fat_g": 35, "fiber_g": 4, "sugar_g": 7, "sodium_mg": 1080 },
  "primaryFoodName": "paneer butter masala with naan",
  "confidence": "medium"
}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new ServiceUnavailableException('AI returned empty response for photo food analysis');
    }

    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      this.logger.error(`AI returned malformed JSON for photoAnalysis: ${clean.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned malformed response');
    }

    // Validate foods array
    if (!Array.isArray(parsed.foods) || parsed.foods.length === 0) {
      throw new BadRequestException('AI could not identify any food in the photo');
    }

    const foods = parsed.foods
      .filter((f: any) => typeof f?.name === 'string' && f.name.trim().length > 0)
      .slice(0, 15)
      .map((f: any) => ({
        name: String(f.name).trim().slice(0, 120),
        servingLabel: typeof f.servingLabel === 'string' ? f.servingLabel.trim().slice(0, 60) : '1 serving',
        servingGrams: this.clampNum(f.servingGrams, 1, 5000, 200),
        perServing: this.clampNutrition(f.perServing),
      }));

    if (foods.length === 0) {
      throw new BadRequestException('AI could not identify any food in the photo');
    }

    // Recompute total from individual items for consistency
    const totalPerServing = this.sumNutrition(foods.map((f) => f.perServing));

    const primaryFoodName =
      typeof parsed.primaryFoodName === 'string' && parsed.primaryFoodName.trim().length > 0
        ? parsed.primaryFoodName.trim().slice(0, 120)
        : foods.length === 1
          ? foods[0].name
          : foods.map((f) => f.name).join(' + ');

    const confidence: 'high' | 'medium' | 'low' =
      ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium';

    this.logger.log(
      `Photo analysis: "${primaryFoodName}" (${foods.length} items, ${totalPerServing.kcal} kcal, confidence=${confidence})`,
    );

    return {
      foods,
      totalPerServing,
      primaryFoodName,
      confidence,
      source: `AI estimate based on photo + ${ctx.nutritionDatabases} references`,
    };
  }

  private clampNutrition(raw: any): NutritionValues {
    return {
      kcal: this.clampNum(raw?.kcal, 0, 5000, 0),
      protein_g: this.clampNum(raw?.protein_g, 0, 500, 0),
      carbs_g: this.clampNum(raw?.carbs_g, 0, 500, 0),
      fat_g: this.clampNum(raw?.fat_g, 0, 500, 0),
      fiber_g: this.clampNum(raw?.fiber_g, 0, 200, 0),
      sugar_g: this.clampNum(raw?.sugar_g, 0, 500, 0),
      sodium_mg: this.clampNum(raw?.sodium_mg, 0, 10000, 0),
    };
  }

  private clampNum(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.max(min, Math.min(max, n));
  }

  private sumNutrition(items: NutritionValues[]): NutritionValues {
    const total: NutritionValues = {
      kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      fiber_g: 0, sugar_g: 0, sodium_mg: 0,
    };
    for (const item of items) {
      total.kcal += item.kcal;
      total.protein_g += item.protein_g;
      total.carbs_g += item.carbs_g;
      total.fat_g += item.fat_g;
      total.fiber_g += item.fiber_g;
      total.sugar_g += item.sugar_g;
      total.sodium_mg += item.sodium_mg;
    }
    // Round all values
    total.kcal = Math.round(total.kcal);
    total.protein_g = Math.round(total.protein_g * 10) / 10;
    total.carbs_g = Math.round(total.carbs_g * 10) / 10;
    total.fat_g = Math.round(total.fat_g * 10) / 10;
    total.fiber_g = Math.round(total.fiber_g * 10) / 10;
    total.sugar_g = Math.round(total.sugar_g * 10) / 10;
    total.sodium_mg = Math.round(total.sodium_mg);
    return total;
  }
}
