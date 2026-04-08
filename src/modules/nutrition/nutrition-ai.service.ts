import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

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
  private readonly openai: OpenAI | null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not set — AI nutrition estimation disabled');
      this.openai = null;
    }
  }

  async estimateNutrition(
    foodDescription: string,
    servingLabel?: string,
    servingGrams?: number,
  ): Promise<AiNutritionEstimate> {
    if (!this.openai) {
      throw new Error('AI estimation is not available — OPENAI_API_KEY is not configured');
    }

    this.logger.log(`AI estimating nutrition for: "${foodDescription}"`);

    const servingContext = servingLabel
      ? `Serving described as: "${servingLabel}"${servingGrams ? ` (~${servingGrams}g)` : ''}`
      : 'No serving size specified — use a typical single serving.';

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a nutrition estimation engine for Saveful India, a food tracking app focused on Indian and global cuisine.
Given a food description over a serving size, estimate the nutritional content as accurately as possible.

RULES:
1. Use USDA, IFCT (Indian Food Composition Tables), and established nutrition databases as reference.
2. For Indian dishes, account for typical cooking methods (oil, ghee, tempering, etc.).
3. If the food is ambiguous, choose the most common preparation.
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
  "source": "AI estimate based on IFCT / USDA references"
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
}
