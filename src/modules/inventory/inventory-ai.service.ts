import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import {
  Ingredient,
  IngredientDocument,
} from '../../database/schemas/ingredient.schema';
import {
  UserInventoryItem,
  UserInventoryItemDocument,
  StorageLocation,
  WasteType,
} from '../../database/schemas/user-inventory.schema';
import { Recipe, RecipeDocument } from '../../database/schemas/recipe.schema';
import { RedisService } from '../../redis/redis.service';


export interface ParsedVoiceItem {
  ingredientId?: string;
  name: string;
  quantity: number;
  unit: string;
  storageLocation: StorageLocation;
  expiryDays: number;
  confidence: number; 
}

export interface MealSuggestion {
  recipe: any;
  matchedIngredients: string[];
  missingIngredients: string[];
  matchPercentage: number;
  expiringIngredientsUsed: string[];
  aiReason?: string;
}

export interface WasteClassification {
  wasteType: WasteType;
  confidence: number;
  disposalTip: string;
}

@Injectable()
export class InventoryAiService {
  private readonly logger = new Logger(InventoryAiService.name);
  private readonly openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  private readonly CACHE_PREFIX = 'inventory-ai';

  constructor(
    @InjectModel(Ingredient.name)
    private ingredientModel: Model<IngredientDocument>,
    @InjectModel(UserInventoryItem.name)
    private inventoryModel: Model<UserInventoryItemDocument>,
    @InjectModel(Recipe.name)
    private recipeModel: Model<RecipeDocument>,
    private readonly redisService: RedisService,
  ) {}


  async parseVoiceTranscript(
    transcript: string,
    country?: string,
  ): Promise<ParsedVoiceItem[]> {
    this.logger.log(`Parsing voice transcript: "${transcript}"`);

    const ingredientFilter: any = {};
    if (country) {
      ingredientFilter.countries = { $in: [country] };
    }
    const ingredients = await this.ingredientModel
      .find(ingredientFilter)
      .select('name aliases isPantryItem categoryId')
      .lean()
      .exec();

    const ingredientNames = ingredients.map((i) => i.name);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: `You are a kitchen inventory assistant for an Indian cooking app called Saveful India.
Your job is to parse a user's voice input about groceries/ingredients they have and convert it into structured data.

RULES:
1. Extract EACH distinct ingredient mentioned.
2. Parse quantity and unit (e.g., "2 kg tomatoes" → quantity: 2, unit: "kg").
3. If no quantity is mentioned, default to 1.
4. If no unit is mentioned, default to "piece" for countable items, "pack" for packaged items.
5. Convert Hindi/regional names to English when possible (e.g., "aloo" → "Potato", "dhaniya" → "Coriander").
6. Match each ingredient to the CLOSEST name from the provided ingredient database list.
7. Determine the best storageLocation: "pantry" for dry goods (rice, dal, spices, oil), "fridge" for perishables (milk, vegetables, fruits), "freezer" for frozen items (frozen peas, ice cream, meat).
8. Estimate expiryDays based on the ingredient type and storage location.
9. Set confidence (0-1) for how sure you are about the ingredient match.

KNOWN INGREDIENTS IN DATABASE:
${ingredientNames.join(', ')}

Respond ONLY with valid JSON, no markdown, no explanation.`,
          },
          {
            role: 'user',
            content: `Parse this voice input into ingredients: "${transcript}"

Return JSON:
{
  "items": [
    {
      "matchedName": "exact name from database list or best guess",
      "originalMention": "what the user actually said",
      "quantity": 2,
      "unit": "kg",
      "storageLocation": "fridge",
      "expiryDays": 7,
      "confidence": 0.95
    }
  ]
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

      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleanContent);

      const results: ParsedVoiceItem[] = [];
      for (const item of parsed.items || []) {
        const matchedNameLower = item.matchedName?.toLowerCase();

        let matchedIngredient = ingredients.find(
          (i) =>
            i.name.toLowerCase() === matchedNameLower,
        );

        if (!matchedIngredient && matchedNameLower) {
          matchedIngredient = ingredients.find(
            (i) =>
              (i as any).aliases?.some(
                (alias: string) => alias.toLowerCase() === matchedNameLower,
              ),
          );
        }

        let ingredientId: string | undefined;
        let finalName = item.matchedName || item.originalMention;

        if (matchedIngredient) {
          ingredientId = (matchedIngredient as any)._id.toString();
          finalName = matchedIngredient.name;
        } else {
          const fuzzy = ingredients.find(
            (i) => {
              const nameLower = i.name.toLowerCase();
              if (
                nameLower.includes(matchedNameLower) ||
                matchedNameLower.includes(nameLower)
              ) return true;
              return (i as any).aliases?.some(
                (alias: string) => {
                  const aliasLower = alias.toLowerCase();
                  return aliasLower.includes(matchedNameLower) ||
                    matchedNameLower.includes(aliasLower);
                },
              );
            },
          );
          if (fuzzy) {
            ingredientId = (fuzzy as any)._id.toString();
            finalName = fuzzy.name;
          }
        }

        results.push({
          ingredientId,
          name: finalName,
          quantity: item.quantity || 1,
          unit: item.unit || 'piece',
          storageLocation: item.storageLocation || StorageLocation.PANTRY,
          expiryDays: item.expiryDays || 7,
          confidence: item.confidence || 0.5,
        });
      }

      this.logger.log(
        `Parsed ${results.length} items from voice transcript`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Voice parsing failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }


  /**
   * Core ingredient-to-recipe matching logic (pure DB, no AI).
   * Used by both quick suggestions and full suggestions.
   * Supports optional ingredientId filter to search recipes by a specific ingredient.
   */
  private async matchRecipesToInventory(
    userId: string,
    country?: string,
    limit = 10,
    filterIngredientId?: string,
  ): Promise<{
    suggestions: MealSuggestion[];
    inventoryNames: string[];
    expiringNames: string[];
    inventoryIngredientIdSet: Set<string>;
  }> {
    const inventoryItems = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
        ingredientId: { $exists: true, $ne: null },
      })
      .lean()
      .exec();

    if (inventoryItems.length === 0) {
      return {
        suggestions: [],
        inventoryNames: [],
        expiringNames: [],
        inventoryIngredientIdSet: new Set(),
      };
    }

    const inventoryIngredientIds = inventoryItems
      .map((i) => i.ingredientId)
      .filter(Boolean);

    const inventoryIngredientIdSet = new Set<string>(
      inventoryIngredientIds.map((id) => id?.toString()).filter((id): id is string => !!id),
    );

    const inventoryNames = inventoryItems.map((i) => i.name);

    const now = new Date();
    const threeDays = new Date();
    threeDays.setDate(now.getDate() + 3);
    const expiringItems = inventoryItems.filter(
      (i) => i.expiresAt && new Date(i.expiresAt) <= threeDays,
    );
    const expiringIngredientIds = new Set(
      expiringItems.map((i) => i.ingredientId?.toString()),
    );

    const recipeFilter: any = { isActive: true };
    if (country) {
      recipeFilter.countries = { $in: [country] };
    }
    // If filtering by a specific ingredient, use MongoDB $or to find recipes containing it
    if (filterIngredientId && Types.ObjectId.isValid(filterIngredientId)) {
      const oid = new Types.ObjectId(filterIngredientId);
      recipeFilter.$or = [
        { 'components.component.requiredIngredients.recommendedIngredient': oid },
        { 'components.component.requiredIngredients.alternativeIngredients.ingredient': oid },
        { 'components.component.optionalIngredients.ingredient': oid },
      ];
    }

    const recipes = await this.recipeModel
      .find(recipeFilter)
      .populate(
        'components.component.requiredIngredients.recommendedIngredient',
        'name',
      )
      .populate(
        'components.component.requiredIngredients.alternativeIngredients.ingredient',
        'name',
      )
      .lean()
      .exec();

    const scoredRecipes: MealSuggestion[] = [];

    for (const recipe of recipes) {
      // Each "slot" is one required-ingredient position.
      // A slot is satisfied if EITHER the recommended ingredient OR any of its
      // alternatives is present in the user's inventory.
      const totalSlots: number[] = [];   // 1 per required ingredient slot
      const matchedSlotIds: string[] = [];
      const missingSlotNames: string[] = [];
      const matchedIngredientNames: string[] = [];

      for (const compWrapper of recipe.components || []) {
        for (const comp of compWrapper.component || []) {
          for (const reqIng of comp.requiredIngredients || []) {
            const recId =
              reqIng.recommendedIngredient?._id?.toString() ||
              reqIng.recommendedIngredient?.toString();

            const recName =
              typeof reqIng.recommendedIngredient === 'object'
                ? (reqIng.recommendedIngredient as any)?.name
                : undefined;

            // Check recommended ingredient first
            let slotMatched = recId && inventoryIngredientIdSet.has(recId);
            let matchedId = slotMatched ? recId : undefined;
            let matchedName = slotMatched ? recName : undefined;

            // If not matched, check any alternative
            if (!slotMatched) {
              for (const alt of reqIng.alternativeIngredients || []) {
                const altId =
                  alt.ingredient?._id?.toString() ||
                  alt.ingredient?.toString();
                if (altId && inventoryIngredientIdSet.has(altId)) {
                  slotMatched = true;
                  matchedId = altId;
                  matchedName =
                    typeof alt.ingredient === 'object'
                      ? (alt.ingredient as any)?.name
                      : undefined;
                  break;
                }
              }
            }

            totalSlots.push(1);
            if (slotMatched && matchedId) {
              matchedSlotIds.push(matchedId);
              if (matchedName) matchedIngredientNames.push(matchedName);
            } else {
              if (recName) missingSlotNames.push(recName);
            }
          }
        }
      }

      if (totalSlots.length === 0) continue;

      const matchPercentage = (matchedSlotIds.length / totalSlots.length) * 100;

      // Require at least 1 matched ingredient — the sort order handles relevance.
      // When filtering by a specific ingredient we drop even the 1-match floor and
      // show everything (MongoDB already guarantees the recipe uses that ingredient).
      const minMatch = filterIngredientId ? 0 : 1;
      if (matchedSlotIds.length < minMatch) continue;

      const expiringUsed = matchedSlotIds.filter((id) =>
        expiringIngredientIds.has(id),
      );

      scoredRecipes.push({
        recipe: {
          _id: recipe._id,
          title: recipe.title,
          shortDescription: recipe.shortDescription,
          heroImageUrl: recipe.heroImageUrl,
          prepCookTime: recipe.prepCookTime,
          portions: recipe.portions,
        },
        matchedIngredients: matchedIngredientNames,
        missingIngredients: missingSlotNames,
        matchPercentage: Math.round(matchPercentage),
        expiringIngredientsUsed: expiringUsed.map(
          (id) =>
            inventoryItems.find((i) => i.ingredientId?.toString() === id)
              ?.name || id,
        ),
      });
    }

    scoredRecipes.sort((a, b) => {
      const expiryDiff =
        b.expiringIngredientsUsed.length - a.expiringIngredientsUsed.length;
      if (expiryDiff !== 0) return expiryDiff;
      return b.matchPercentage - a.matchPercentage;
    });

    return {
      suggestions: scoredRecipes.slice(0, limit),
      inventoryNames,
      expiringNames: expiringItems.map((i) => i.name),
      inventoryIngredientIdSet,
    };
  }


  /**
   * Quick meal suggestions — pure DB matching with Redis cache, no AI calls.
   * Supports optional ingredientId filter for searching recipes by ingredient.
   * Cache is keyed per user + ingredient count hash so new ingredients auto-invalidate.
   */
  async getMealSuggestionsQuick(
    userId: string,
    country?: string,
    limit = 10,
    filterIngredientId?: string,
  ): Promise<MealSuggestion[]> {
    // Build a cache key including the ingredient filter
    const cacheKeySuffix = filterIngredientId
      ? `:ing:${filterIngredientId}`
      : '';
    const cacheKey = `${this.CACHE_PREFIX}:suggestions:quick:${userId}${cacheKeySuffix}`;

    // Check Redis cache (short TTL: 3 minutes)
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.log(`Quick suggestions cache hit for user ${userId}`);
        return JSON.parse(cached);
      }
    } catch (e) {
      this.logger.warn('Quick suggestions cache read failed:', e?.message);
    }

    const { suggestions } = await this.matchRecipesToInventory(
      userId,
      country,
      limit,
      filterIngredientId,
    );

    // Cache for 3 minutes
    try {
      await this.redisService.set(cacheKey, JSON.stringify(suggestions), 180);
    } catch (e) {
      this.logger.warn('Quick suggestions cache write failed:', e?.message);
    }

    return suggestions;
  }


  /**
   * Full meal suggestions with optional AI enrichment.
   * Calls the shared matching logic, then enriches with AI if ≤5 results.
   */
  async getMealSuggestions(
    userId: string,
    country?: string,
    limit = 10,
  ): Promise<MealSuggestion[]> {
    const { suggestions, inventoryNames, expiringNames } =
      await this.matchRecipesToInventory(userId, country, limit);

    if (suggestions.length > 0 && suggestions.length <= 5) {
      try {
        const aiEnriched = await this.enrichSuggestionsWithAI(
          suggestions,
          inventoryNames,
          expiringNames,
        );
        return aiEnriched;
      } catch (e) {
        this.logger.warn('AI enrichment failed, returning raw suggestions');
      }
    }

    return suggestions;
  }


  /**
   * Compute new recipe matches after an inventory change.
   * Compares current matches with previously cached matches to find NEW recipes.
   * Returns the new matches (if any) for notification purposes.
   */
  async getNewMatchesAfterInventoryChange(
    userId: string,
    country?: string,
  ): Promise<MealSuggestion[]> {
    const previousCacheKey = `${this.CACHE_PREFIX}:suggestions:prev-ids:${userId}`;

    // Get previously known recipe IDs
    let previousRecipeIds: Set<string> = new Set();
    try {
      const cached = await this.redisService.get(previousCacheKey);
      if (cached) {
        previousRecipeIds = new Set(JSON.parse(cached));
      }
    } catch (e) {
      // No previous data — all current matches will be considered "new"
    }

    const { suggestions } = await this.matchRecipesToInventory(
      userId,
      country,
      20, // cast wider net
    );

    const currentRecipeIds = suggestions.map((s) => s.recipe._id.toString());

    // Store current IDs for next comparison (TTL: 24 hours)
    try {
      await this.redisService.set(
        previousCacheKey,
        JSON.stringify(currentRecipeIds),
        86400,
      );
    } catch (e) {
      this.logger.warn('Failed to cache previous recipe IDs:', e?.message);
    }

    // Invalidate the quick suggestions cache so next fetch gets fresh data
    try {
      await this.redisService.del(
        `${this.CACHE_PREFIX}:suggestions:quick:${userId}`,
      );
    } catch (e) {
      // non-critical
    }

    // If no previous data, don't spam notifications for all matches
    if (previousRecipeIds.size === 0) {
      return [];
    }

    // Find recipes that are NEW (not in the previous set)
    const newMatches = suggestions.filter(
      (s) => !previousRecipeIds.has(s.recipe._id.toString()),
    );

    // Only return high-quality new matches (≥60% match)
    return newMatches.filter((s) => s.matchPercentage >= 60);
  }

  private async enrichSuggestionsWithAI(
    suggestions: MealSuggestion[],
    inventoryNames: string[],
    expiringNames: string[],
  ): Promise<MealSuggestion[]> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a helpful Indian cooking assistant. Given recipe suggestions matched from a user's pantry, provide a SHORT reason (1 sentence) for why each recipe is a good choice right now. Consider expiring ingredients that should be used first.`,
        },
        {
          role: 'user',
          content: `User has these ingredients: ${inventoryNames.join(', ')}
Expiring soon: ${expiringNames.length > 0 ? expiringNames.join(', ') : 'none'}

Recipe suggestions:
${suggestions.map((s, i) => `${i + 1}. "${s.recipe.title}" — ${s.matchPercentage}% match, uses ${s.matchedIngredients.length} of user's ingredients${s.expiringIngredientsUsed.length > 0 ? `, uses expiring: ${s.expiringIngredientsUsed.join(', ')}` : ''}`).join('\n')}

Return JSON array of reasons:
{ "reasons": ["reason for recipe 1", "reason for recipe 2", ...] }`,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    try {
      let content = response.choices[0]?.message?.content?.trim() || '';
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(content);
      return suggestions.map((s, i) => ({
        ...s,
        aiReason: parsed.reasons?.[i] || undefined,
      }));
    } catch {
      return suggestions;
    }
  }


  async classifyWaste(
    ingredientName: string,
    packaging?: string,
  ): Promise<WasteClassification> {
    const rulesResult = this.classifyByRules(ingredientName, packaging);
    if (rulesResult) return rulesResult;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: `You are a waste segregation assistant for households.
Classify kitchen waste into:
- "wet_waste": Wet/Organic waste — biodegradable (vegetable peels, fruit scraps, leftover food, eggshells, tea leaves, coffee grounds)
- "dry_waste": Dry waste — recyclable (plastic containers, foil, cardboard, glass jars, paper)
- "hazardous": Hazardous — special disposal (cooking oil in bulk, batteries, medicines, chemical cleaners)

IMPORTANT:
- For meat/fish scraps, always mention wrapping in paper before binning to reduce odours and keep critters out. Never recommend plastic wrapping.
- For fruit and vegetables, remind users that slightly soft, spotted, wilted or overripe produce may still be perfectly good for soups, smoothies or stir-fries.
- Use Australian English spelling (e.g. "odour" not "odor", "colour" not "color", "organise" not "organize", "centre" not "center").

Respond in JSON only: { "wasteType": "...", "confidence": 0.95, "disposalTip": "short tip" }`,
          },
          {
            role: 'user',
            content: `Classify waste: "${ingredientName}"${packaging ? ` in ${packaging} packaging` : ''}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      });

      let content = response.choices[0]?.message?.content?.trim() || '';
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }
      return JSON.parse(content);
    } catch (error) {
      this.logger.error(`Waste classification failed: ${error.message}`);
      return {
        wasteType: WasteType.WET,
        confidence: 0.3,
        disposalTip:
          'When unsure, food items generally go in wet/organic waste (green bin). Compost if possible!',
      };
    }
  }

  private classifyByRules(
    name: string,
    packaging?: string,
  ): WasteClassification | null {
    const lower = name.toLowerCase();

    const wetKeywords = [
      'vegetable', 'fruit', 'peel', 'leaf', 'leaves', 'leftover',
      'rice', 'roti', 'chapati', 'dal', 'curry', 'sabzi', 'salad',
      'egg', 'eggshell', 'tea', 'coffee', 'flower', 'meat', 'fish',
      'chicken', 'paneer', 'curd', 'yogurt', 'bread', 'milk',
      'tomato', 'onion', 'potato', 'carrot', 'spinach', 'cabbage',
      'cauliflower', 'banana', 'apple', 'mango', 'orange', 'lemon',
      'ginger', 'garlic', 'coriander', 'mint', 'chilli', 'pepper',
      'cucumber', 'brinjal', 'okra', 'beans', 'peas',
      'lamb', 'beef', 'pork', 'mince', 'prawn', 'shrimp', 'salmon',
      'tuna', 'turkey', 'duck', 'sausage', 'bacon',
    ];

    const meatKeywords = [
      'meat', 'fish', 'chicken', 'lamb', 'beef', 'pork', 'mince',
      'prawn', 'shrimp', 'salmon', 'tuna', 'turkey', 'duck',
      'sausage', 'bacon',
    ];

    const fruitVegKeywords = [
      'vegetable', 'fruit', 'tomato', 'onion', 'potato', 'carrot',
      'spinach', 'cabbage', 'cauliflower', 'banana', 'apple', 'mango',
      'orange', 'lemon', 'cucumber', 'brinjal', 'okra', 'beans', 'peas',
      'capsicum', 'zucchini', 'avocado', 'pear', 'peach', 'berry',
      'berries', 'grape', 'kiwi', 'pineapple', 'melon', 'lettuce',
      'celery', 'broccoli', 'mushroom', 'corn', 'beetroot', 'pumpkin',
    ];

    if (wetKeywords.some((kw) => lower.includes(kw))) {
      const isMeat = meatKeywords.some((kw) => lower.includes(kw));
      const isFruitVeg = fruitVegKeywords.some((kw) => lower.includes(kw));

      if (packaging && ['plastic', 'foil', 'cardboard'].includes(packaging.toLowerCase())) {
        return {
          wasteType: WasteType.WET,
          confidence: 0.9,
          disposalTip: `The ${name} goes in wet/organic waste (green bin). Separate the ${packaging} packaging into dry waste (blue bin).`,
        };
      }

      if (isMeat) {
        return {
          wasteType: WasteType.WET,
          confidence: 0.95,
          disposalTip: `Got ${lower} scraps? Wrap them in paper before binning to keep odours down and critters out. Paper good. Plastic no thanks.`,
        };
      }

      if (isFruitVeg) {
        return {
          wasteType: WasteType.WET,
          confidence: 0.95,
          disposalTip: `${name} is organic waste — pop it in the green bin or compost it!`,
        };
      }

      return {
        wasteType: WasteType.WET,
        confidence: 0.95,
        disposalTip: `${name} is organic waste — put in wet/organic waste (green bin). Can be composted or added to your garden!`,
      };
    }

    const dryKeywords = [
      'plastic', 'packet', 'wrapper', 'foil', 'tin', 'can',
      'cardboard', 'paper', 'glass', 'jar', 'bottle', 'container',
      'tetra', 'pack', 'sachet', 'pouch',
    ];

    if (
      packaging &&
      dryKeywords.some((kw) => packaging.toLowerCase().includes(kw))
    ) {
      return {
        wasteType: WasteType.DRY,
        confidence: 0.9,
        disposalTip: `${packaging} packaging goes in dry waste (blue bin). Rinse if it had food residue.`,
      };
    }

    const hazardousKeywords = [
      'oil', 'cooking oil', 'medicine', 'battery', 'chemical',
      'cleaner', 'detergent', 'paint', 'thermometer',
    ];

    if (hazardousKeywords.some((kw) => lower === kw)) {
      return {
        wasteType: WasteType.HAZARDOUS,
        confidence: 0.85,
        disposalTip: `${name} requires special disposal. Do not pour down the drain. Check local hazardous waste collection.`,
      };
    }

    return null; 
  }

  async estimateShelfLife(
    dishName: string,
    storageLocation: string,
    dishCategory?: string,
  ): Promise<{
    shelfLifeDays: number;
    useByDate: string;
    confidence: number;
    storageTip: string;
    warningSign: string;
  }> {
    const cacheKey = `${this.CACHE_PREFIX}:shelf-life:${dishName.toLowerCase().trim()}:${storageLocation}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    const defaultDays: Record<string, number> = {
      pantry: 1,
      fridge: 3,
      freezer: 90,
    };

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: `You are a food safety expert specialising in Indian cuisine and home-cooked meals.
Given a cooked dish name and its storage location, estimate how long the leftovers will stay safe and good to eat.

GUIDELINES:
- Be specific to the dish type. Curries with gravy last longer than dry items. Rice spoils faster than dal.
- Dairy-heavy dishes (paneer, raita, kheer) spoil faster in fridge.
- Fried items (pakora, vada) lose quality fast but are safe longer.
- Freezer estimates should reflect quality, not just safety.
- Storage location: "pantry" = room temperature in Indian climate (25-35°C), "fridge" = 4°C, "freezer" = -18°C.

Respond ONLY with valid JSON, no markdown:
{
  "shelfLifeDays": <number>,
  "confidence": <0-1>,
  "storageTip": "<1-2 sentence specific tip for THIS dish in THIS storage>",
  "warningSign": "<what to look/smell for to know it has gone bad>"
}`,
          },
          {
            role: 'user',
            content: `Dish: "${dishName}"${dishCategory ? ` (Category: ${dishCategory})` : ''}
Storage: ${storageLocation}
How many days will this last?`,
          },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      let content = response.choices[0]?.message?.content?.trim() || '';
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(content);
      const days = Math.max(1, Math.round(parsed.shelfLifeDays || defaultDays[storageLocation] || 3));
      const useByDate = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
      ).toISOString();

      const result = {
        shelfLifeDays: days,
        useByDate,
        confidence: parsed.confidence ?? 0.7,
        storageTip: parsed.storageTip || 'Store in a sealed airtight container.',
        warningSign: parsed.warningSign || 'Discard if you notice off smells, sliminess, or mould.',
      };

      try {
        await this.redisService.set(cacheKey, JSON.stringify(result), 7 * 24 * 60 * 60);
      } catch {}

      return result;
    } catch (error) {
      this.logger.error(`Shelf-life estimation failed for "${dishName}": ${error.message}`);
      const days = defaultDays[storageLocation] || 3;
      return {
        shelfLifeDays: days,
        useByDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        confidence: 0.3,
        storageTip: 'Store in a sealed airtight container.',
        warningSign: 'Discard if you notice off smells, sliminess, or mould.',
      };
    }
  }
  async getLeftoverMakeoverIdeas(
    dishName: string,
    storageLocation?: string,
    country?: string,
  ): Promise<{
    ideas: Array<{
      title: string;
      description: string;
      effort: 'easy' | 'medium';
      timeMinutes: number;
    }>;
  }> {
    const cacheKey = `${this.CACHE_PREFIX}:makeover:${dishName.toLowerCase().trim()}:${storageLocation || 'any'}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: `You are a creative Indian home cook assistant for the Saveful India app.
Given leftover cooked food, suggest 4-5 creative and practical ways to transform it into a new meal.

RULES:
1. Suggestions must be SPECIFIC to the dish — not generic "make a wrap" advice.
2. Each idea should feel like a real transformation, not just reheating.
3. Prefer ideas that use minimal extra ingredients (things most Indian kitchens have).
4. Mix easy (5-10 min) and medium-effort (15-30 min) ideas.
5. Consider Indian kitchen staples: onion, tomato, basic spices, oil, bread/roti, rice, eggs.
6. If the storage is "freezer", include a thawing/reheating tip in the description.
${country === 'IN' ? '7. Focus on Indian cooking styles and flavour profiles.' : '7. Include a mix of Indian and international fusion ideas.'}

Respond ONLY with valid JSON:
{
  "ideas": [
    {
      "title": "Short catchy name",
      "description": "1-2 sentences on how to make it",
      "effort": "easy" or "medium",
      "timeMinutes": <number>
    }
  ]
}`,
          },
          {
            role: 'user',
            content: `I have leftover "${dishName}"${storageLocation ? ` stored in the ${storageLocation}` : ''}. What can I transform it into?`,
          },
        ],
        temperature: 0.7,
        max_tokens: 600,
      });

      let content = response.choices[0]?.message?.content?.trim() || '';
      if (content.startsWith('```')) {
        content = content
          .replace(/^```(?:json)?\n?/, '')
          .replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(content);
      const result = {
        ideas: (parsed.ideas || []).slice(0, 5).map((idea: any) => ({
          title: idea.title || 'Leftover remix',
          description: idea.description || '',
          effort: idea.effort === 'medium' ? 'medium' : 'easy',
          timeMinutes: idea.timeMinutes || 15,
        })),
      };
      try {
        await this.redisService.set(cacheKey, JSON.stringify(result), 3 * 24 * 60 * 60);
      } catch {}

      return result;
    } catch (error) {
      this.logger.error(`Makeover ideas generation failed for "${dishName}": ${error.message}`);
      return {
        ideas: [
          {
            title: `${dishName} Stuffed Paratha`,
            description: `Mix leftover ${dishName} with spices, stuff into roti dough, and pan-fry until golden.`,
            effort: 'medium',
            timeMinutes: 20,
          },
          {
            title: `${dishName} Fried Rice`,
            description: `Stir-fry day-old rice with chopped ${dishName}, soy sauce, and a fried egg on top.`,
            effort: 'easy',
            timeMinutes: 10,
          },
          {
            title: `${dishName} Wrap / Roll`,
            description: `Warm a roti or tortilla, add ${dishName}, fresh onion, chutney, and roll it up.`,
            effort: 'easy',
            timeMinutes: 5,
          },
        ],
      };
    }
  }
}
