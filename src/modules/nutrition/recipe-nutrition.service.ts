import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  RecipeNutrition,
  RecipeNutritionDocument,
} from '../../database/schemas/nutrition/recipe-nutrition.schema';
import { Recipe, RecipeDocument } from '../../database/schemas/recipe.schema';
import { Ingredient, IngredientDocument } from '../../database/schemas/ingredient.schema';
import { NutritionAiService } from './nutrition-ai.service';
import { getCountryName } from '../../common/utils/country-cuisine.util';

interface IngredientLine {
  ingredientId: string;
  name: string;
  quantity: string;
  preparation: string;
}

@Injectable()
export class RecipeNutritionService {
  private readonly logger = new Logger(RecipeNutritionService.name);
  /** In-flight AI computation promises keyed by recipeId – prevents duplicate AI calls */
  private readonly inflightCompute = new Map<string, Promise<RecipeNutritionDocument>>();

  constructor(
    @InjectModel(RecipeNutrition.name)
    private readonly recipeNutritionModel: Model<RecipeNutritionDocument>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<RecipeDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    private readonly nutritionAi: NutritionAiService,
  ) {}

  /**
   * Get cached nutrition or compute via AI, then cache.
   */
  async getOrCompute(recipeId: string): Promise<RecipeNutritionDocument> {
    const recipe = await this.recipeModel
      .findById(recipeId)
      .lean<RecipeDocument>()
      .exec();
    if (!recipe) throw new NotFoundException('Recipe not found');

    const ingredients = this.extractIngredients(recipe);
    const hash = this.computeHash(ingredients);

    // Check cache
    const cached = await this.recipeNutritionModel
      .findOne({ recipeId: new Types.ObjectId(recipeId) })
      .lean<RecipeNutritionDocument>()
      .exec();

    if (cached && cached.ingredientHash === hash) {
      return cached;
    }

    // Deduplicate concurrent AI calls for the same recipe
    const inflight = this.inflightCompute.get(recipeId);
    if (inflight) {
      return inflight;
    }

    const promise = this.doCompute(recipeId, recipe, ingredients, hash);
    this.inflightCompute.set(recipeId, promise);
    try {
      return await promise;
    } finally {
      this.inflightCompute.delete(recipeId);
    }
  }

  private async doCompute(
    recipeId: string,
    recipe: RecipeDocument,
    ingredients: IngredientLine[],
    hash: string,
  ): Promise<RecipeNutritionDocument> {
    // Compute via AI
    const result = await this.computeNutrition(recipe, ingredients);

    // Upsert cache
    const doc = await this.recipeNutritionModel.findOneAndUpdate(
      { recipeId: new Types.ObjectId(recipeId) },
      { $set: { ...result, ingredientHash: hash } },
      { new: true, upsert: true },
    ).exec();

    return doc!;
  }

 
  async getRecipeTitle(recipeId: string): Promise<string> {
    const recipe = await this.recipeModel
      .findById(recipeId)
      .select('title')
      .lean()
      .exec();
    return (recipe as any)?.title ?? 'Recipe';
  }

 
  async searchRecipes(
    query: string,
    limit = 20,
    country?: string,
  ): Promise<any[]> {
    // Clamp limit to prevent abuse
    const safeLimit = Math.min(Math.max(1, Number.isFinite(limit) ? limit : 20), 50);

    const filter: any = { isActive: true };
    if (query && query.trim().length > 0) {
      // Escape regex special chars to prevent ReDoS / injection
      const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.title = { $regex: escaped, $options: 'i' };
    }
    if (country) {
      filter.$or = [
        { countries: { $size: 0 } },
        { countries: country },
      ];
    }

    const recipes = await this.recipeModel
      .find(filter)
      .select('title shortDescription heroImageUrl portions prepCookTime frameworkCategories')
      .sort({ order: 1 })
      .limit(safeLimit)
      .lean()
      .exec();

    // Attach cached nutrition if available
    const recipeIds = recipes.map((r: any) => r._id);
    const nutritionDocs = await this.recipeNutritionModel
      .find({ recipeId: { $in: recipeIds } })
      .lean()
      .exec();
    const nutritionMap = new Map(
      nutritionDocs.map((n: any) => [String(n.recipeId), n]),
    );

    return recipes.map((r: any) => ({
      ...r,
      nutrition: nutritionMap.get(String(r._id)) ?? null,
    }));
  }

  private extractIngredients(recipe: RecipeDocument): IngredientLine[] {
    const lines: IngredientLine[] = [];
    const seen = new Set<string>();

    for (const wrapper of (recipe as any).components ?? []) {
      for (const comp of wrapper.component ?? []) {
        for (const req of comp.requiredIngredients ?? []) {
          const id = String(req.recommendedIngredient);
          if (!seen.has(id)) {
            seen.add(id);
            lines.push({
              ingredientId: id,
              name: '', // will be resolved
              quantity: req.quantity ?? '',
              preparation: req.preparation ?? '',
            });
          }
        }
        for (const opt of comp.optionalIngredients ?? []) {
          const id = String(opt.ingredient);
          if (!seen.has(id)) {
            seen.add(id);
            lines.push({
              ingredientId: id,
              name: '',
              quantity: opt.quantity ?? '',
              preparation: opt.preparation ?? '',
            });
          }
        }
      }
    }

    return lines;
  }

  private computeHash(ingredients: IngredientLine[]): string {
    const data = ingredients
      .map((i) => `${i.ingredientId}:${i.quantity}`)
      .sort()
      .join('|');
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private parseServings(portions: string): number {
    // e.g. "4-6 servings" → 5, "2 servings" → 2, "Serves 4" → 4
    const match = portions?.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (match) {
      return Math.round((parseInt(match[1]) + parseInt(match[2])) / 2);
    }
    const single = portions?.match(/(\d+)/);
    return single ? parseInt(single[1]) : 1;
  }

  private async computeNutrition(
    recipe: RecipeDocument,
    ingredients: IngredientLine[],
  ) {
    // Resolve ingredient names
    const ingredientIds = ingredients.map((i) => new Types.ObjectId(i.ingredientId));
    const ingredientDocs = await this.ingredientModel
      .find({ _id: { $in: ingredientIds } })
      .select('name')
      .lean()
      .exec();
    const nameMap = new Map(
      ingredientDocs.map((d: any) => [String(d._id), d.name]),
    );

    for (const ing of ingredients) {
      ing.name = nameMap.get(ing.ingredientId) ?? 'unknown';
    }

    // Build description for AI
    const ingredientList = ingredients
      .map((i) => `${i.quantity} ${i.name} (${i.preparation})`)
      .join(', ');

    // Use the recipe's country association for cuisine context
    const recipeCountry: string | undefined = ((recipe as any).countries ?? [])[0];
    const cuisineLabel = recipeCountry ? `${getCountryName(recipeCountry)} recipe` : 'recipe';
    const description = `${cuisineLabel} "${(recipe as any).title}" with ingredients: ${ingredientList}. Recipe makes ${(recipe as any).portions || '1 serving'}.`;

    this.logger.log(`Computing nutrition for recipe: ${(recipe as any).title}`);

    // Get AI estimate for entire recipe
    const estimate = await this.nutritionAi.estimateNutrition(
      description,
      `entire recipe (${(recipe as any).portions || '1 serving'})`,
      undefined,
      recipeCountry,
    );

    const totalServings = this.parseServings((recipe as any).portions ?? '1');

    const ingredientBreakdown = await this.computeIngredientBreakdown(ingredients, recipeCountry);

    // AI estimates nutrition for the ENTIRE recipe (we passed the full ingredient list).
    // estimate.perServing is the AI's whole-recipe output keyed as "perServing".
    const totalNutrition = {
      kcal: estimate.perServing.kcal,
      protein_g: estimate.perServing.protein_g,
      carbs_g: estimate.perServing.carbs_g,
      fat_g: estimate.perServing.fat_g,
      fiber_g: estimate.perServing.fiber_g,
      sugar_g: estimate.perServing.sugar_g,
      sodium_mg: estimate.perServing.sodium_mg,
    };

    const safeDivisor = Math.max(1, totalServings);
    const perServing = {
      kcal: Math.round(totalNutrition.kcal / safeDivisor),
      protein_g: Math.round((totalNutrition.protein_g / safeDivisor) * 10) / 10,
      carbs_g: Math.round((totalNutrition.carbs_g / safeDivisor) * 10) / 10,
      fat_g: Math.round((totalNutrition.fat_g / safeDivisor) * 10) / 10,
      fiber_g: Math.round((totalNutrition.fiber_g / safeDivisor) * 10) / 10,
      sugar_g: Math.round((totalNutrition.sugar_g / safeDivisor) * 10) / 10,
      sodium_mg: Math.round(totalNutrition.sodium_mg / safeDivisor),
    };

    return {
      recipeId: new Types.ObjectId(String((recipe as any)._id)),
      totalServings,
      totalNutrition,
      perServing,
      servingGrams: Math.round((estimate.servingGrams ?? 0) / safeDivisor),
      ingredientBreakdown,
      confidence: estimate.confidence,
      ingredientHash: this.computeHash(ingredients),
      source: estimate.source ?? 'AI estimate based on nutrition database references',
    };
  }

  private async computeIngredientBreakdown(
    ingredients: IngredientLine[],
    country?: string,
  ) {
    if (ingredients.length === 0) return [];

    try {
      const estimates = await this.nutritionAi.estimateIngredientBreakdown(
        ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          preparation: i.preparation,
        })),
        country,
      );

      return ingredients.map((ing, idx) => ({
        ingredientId: new Types.ObjectId(ing.ingredientId),
        name: ing.name,
        quantity: ing.quantity,
        nutrition: estimates[idx] ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to estimate ingredient breakdown: ${message}`);
      return ingredients.map((ing) => ({
        ingredientId: new Types.ObjectId(ing.ingredientId),
        name: ing.name,
        quantity: ing.quantity,
        nutrition: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
      }));
    }
  }
}
