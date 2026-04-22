import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { getCuisineContext } from '../../common/utils/country-cuisine.util';
import { MealSlotType } from '../../database/schemas/meal-plan.schema';
import { AIInteractionService } from '../ai-interaction/ai-interaction.service';
import {
  AIFeatureKey,
  AIResultType,
} from '../../database/schemas/ai-interaction-event.schema';

export interface AiMealNutrition {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface AiPlanMeal {
  slot: MealSlotType;
  title: string;
  description: string;
  estimatedNutrition: AiMealNutrition;
  ingredients: string[];
  inventoryMatches: string[];
  missingIngredients: string[];
  fromInventory: boolean;
}

export interface AiPlanDay {
  dayNumber: number;
  label: string;
  meals: AiPlanMeal[];
  daySummary: AiMealNutrition;
}

export interface AiMealPlanResult {
  title: string;
  totalDays: number;
  days: AiPlanDay[];
  healthGoal: string;
}

export interface MealPlanGenerationContext {
  requestedDays?: number;
  preference?: string;
  country?: string;
  targets?: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  };
  goalType?: string;
  dietary?: {
    vegType?: string;
    dairyFree?: boolean;
    nutFree?: boolean;
    glutenFree?: boolean;
    hasDiabetes?: boolean;
    otherAllergies?: string[];
    tastePreference?: string[];
  };
  inventory?: { name: string; quantity: number; unit: string; freshness: string }[];
}

@Injectable()
export class MealPlanAiService {
  private readonly logger = new Logger(MealPlanAiService.name);

  constructor(
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI | null,
    @Optional() private readonly aiTracker?: AIInteractionService,
  ) {
    if (!this.openai) {
      this.logger.warn('OPENAI_API_KEY not set — AI meal planning disabled');
    }
  }

  async generateMealPlan(
    ctx: MealPlanGenerationContext,
    userId?: string,
  ): Promise<AiMealPlanResult & { aiEventId?: string }> {
    if (!this.openai) {
      throw new ServiceUnavailableException('AI meal planning is not available — OPENAI_API_KEY is not configured');
    }

    const cuisineCtx = getCuisineContext(ctx.country);
    const inventoryText = ctx.inventory?.length
      ? ctx.inventory
          .map(
            (i) =>
              `• ${i.name} — ${i.quantity} ${i.unit} (${i.freshness})`,
          )
          .join('\n')
      : 'No inventory data available.';

    const dietaryLines: string[] = [];
    if (ctx.dietary) {
      const d = ctx.dietary;
      dietaryLines.push(`Diet type: ${d.vegType ?? 'OMNI'}`);
      if (d.dairyFree) dietaryLines.push('Dairy-free');
      if (d.nutFree) dietaryLines.push('Nut-free');
      if (d.glutenFree) dietaryLines.push('Gluten-free');
      if (d.hasDiabetes) dietaryLines.push('Diabetic-friendly (low GI, controlled carbs)');
      if (d.otherAllergies?.length)
        dietaryLines.push(`Allergies: ${d.otherAllergies.join(', ')}`);
      if (d.tastePreference?.length)
        dietaryLines.push(`Taste preferences: ${d.tastePreference.join(', ')}`);
    }

    const targetLines = ctx.targets
      ? [
          `Daily targets — Calories: ${ctx.targets.kcal} kcal`,
          `Protein: ${ctx.targets.protein_g}g, Carbs: ${ctx.targets.carbs_g}g, Fat: ${ctx.targets.fat_g}g, Fiber: ${ctx.targets.fiber_g}g`,
        ]
      : ['Daily targets: use healthy balanced defaults'];

    const daysInstruction = ctx.requestedDays
      ? `The user wants a ${ctx.requestedDays}-day plan.`
      : `Decide the optimal number of days (3–14) based on the inventory. If there is sufficient inventory to cover 7+ days, suggest 7. If inventory is sparse, suggest 3–5 days so the plan remains realistic.`;

    const preferenceNote = ctx.preference ? `\nUser note: ${ctx.preference}` : '';

    const systemPrompt = `You are SavefulAI, a world-class meal planning engine.
You create personalised, practical meal plans that respect dietary restrictions, match calorie targets, and prioritise available inventory.
Country / cuisine context: ${cuisineCtx.countryName} (${cuisineCtx.cuisineFocus}).
Example local dishes: ${cuisineCtx.exampleDishes}.`;

    const userPrompt = `
DIETARY REQUIREMENTS:
${dietaryLines.join('\n') || 'None'}

CALORIE / MACRO TARGETS:
${targetLines.join('\n')}

GOAL: ${ctx.goalType ?? 'maintain'}

DIGITAL INVENTORY (use these ingredients first, prioritise items expiring soon):
${inventoryText}
${preferenceNote}

TASK: ${daysInstruction}
Create a personalised meal plan. For each day provide 4 meals: breakfast, lunch, snack and dinner.
For every meal:
- Choose a title and brief description fitting ${cuisineCtx.countryName} cuisine.
- Estimate kcal, protein_g, carbs_g, fat_g, fiber_g per meal.
- List all ingredients required (ingredient name strings only).
- Cross-check against the inventory list above and split into inventoryMatches (ingredients the user has) and missingIngredients (ingredients they lack).
- Set fromInventory: true only if ALL required ingredients are in inventory.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "title": "string (e.g. '7-Day Balanced Indian Plan')",
  "totalDays": number,
  "healthGoal": "short description of goal",
  "days": [
    {
      "dayNumber": 1,
      "label": "Day 1 — Monday",
      "daySummary": { "kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0 },
      "meals": [
        {
          "slot": "breakfast",
          "title": "Oats Upma",
          "description": "Light savoury oats with vegetables",
          "estimatedNutrition": { "kcal": 320, "protein_g": 10, "carbs_g": 48, "fat_g": 8, "fiber_g": 5 },
          "ingredients": ["Rolled oats", "Onion", "Carrot", "Green chilli", "Mustard seeds", "Curry leaves", "Salt"],
          "inventoryMatches": ["Rolled oats", "Onion"],
          "missingIngredients": ["Carrot", "Green chilli"],
          "fromInventory": false
        }
      ]
    }
  ]
}
`.trim();

    const startedAt = Date.now();
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
    });

    const raw = response.choices[0]?.message?.content ?? '';

    let parsed: AiMealPlanResult;
    try {
      parsed = JSON.parse(raw) as AiMealPlanResult;
    } catch {
      this.logger.error('AI meal plan JSON parse error', raw.slice(0, 400));
      if (this.aiTracker) {
        await this.aiTracker.logFromResponse(
          {
            userId: userId ?? null,
            feature: AIFeatureKey.RECIPE_GEN,
            resultType: AIResultType.ERROR,
            latencyMs: Date.now() - startedAt,
            metadata: { action: 'generate_meal_plan', parseFailure: true },
          },
          response,
        );
      }
      throw new ServiceUnavailableException('AI returned invalid meal plan — please try again');
    }

    if (!Array.isArray(parsed.days) || parsed.days.length === 0) {
      if (this.aiTracker) {
        await this.aiTracker.logFromResponse(
          {
            userId: userId ?? null,
            feature: AIFeatureKey.RECIPE_GEN,
            resultType: AIResultType.NO_RESULT,
            latencyMs: Date.now() - startedAt,
            metadata: { action: 'generate_meal_plan', emptyPlan: true },
          },
          response,
        );
      }
      throw new ServiceUnavailableException('AI returned empty meal plan — please try again');
    }

    let aiEventId: string | undefined;
    if (this.aiTracker) {
      const id = await this.aiTracker.logFromResponse(
        {
          userId: userId ?? null,
          feature: AIFeatureKey.RECIPE_GEN,
          resultType: AIResultType.RECIPE_GENERATED,
          latencyMs: Date.now() - startedAt,
          metadata: {
            action: 'generate_meal_plan',
            totalDays: parsed.totalDays,
            country: ctx.country,
          },
        },
        response,
      );
      aiEventId = id ?? undefined;
    }

    return { ...parsed, aiEventId };
  }
}
