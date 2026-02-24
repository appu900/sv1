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
      .select('name isPantryItem categoryId')
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
        const matchedIngredient = ingredients.find(
          (i) =>
            i.name.toLowerCase() === item.matchedName?.toLowerCase(),
        );

        let ingredientId: string | undefined;
        let finalName = item.matchedName || item.originalMention;

        if (matchedIngredient) {
          ingredientId = (matchedIngredient as any)._id.toString();
          finalName = matchedIngredient.name;
        } else {
          const fuzzy = ingredients.find(
            (i) =>
              i.name.toLowerCase().includes(item.matchedName?.toLowerCase()) ||
              item.matchedName?.toLowerCase().includes(i.name.toLowerCase()),
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


  async getMealSuggestions(
    userId: string,
    country?: string,
    limit = 10,
  ): Promise<MealSuggestion[]> {
    const inventoryItems = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
        ingredientId: { $exists: true, $ne: null },
      })
      .lean()
      .exec();

    if (inventoryItems.length === 0) {
      return [];
    }

    const inventoryIngredientIds = inventoryItems
      .map((i) => i.ingredientId)
      .filter(Boolean);

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

    const recipes = await this.recipeModel
      .find(recipeFilter)
      .populate(
        'components.component.requiredIngredients.recommendedIngredient',
        'name',
      )
      .lean()
      .exec();

    const scoredRecipes: MealSuggestion[] = [];

    for (const recipe of recipes) {
      const allRequired: string[] = [];
      const allRequiredNames: string[] = [];

      for (const compWrapper of recipe.components || []) {
        for (const comp of compWrapper.component || []) {
          for (const reqIng of comp.requiredIngredients || []) {
            const ingId = reqIng.recommendedIngredient?._id?.toString() ||
              reqIng.recommendedIngredient?.toString();
            if (ingId) {
              allRequired.push(ingId);
              const ingName =
                typeof reqIng.recommendedIngredient === 'object'
                  ? (reqIng.recommendedIngredient as any)?.name
                  : undefined;
              if (ingName) allRequiredNames.push(ingName);
            }
          }
        }
      }

      if (allRequired.length === 0) continue;

      const matched = allRequired.filter((id) =>
        inventoryIngredientIds.some((invId) => invId?.toString() === id),
      );
      const missing = allRequired.filter(
        (id) =>
          !inventoryIngredientIds.some((invId) => invId?.toString() === id),
      );
      const matchPercentage = (matched.length / allRequired.length) * 100;

      if (matchPercentage < 40) continue;

      const expiringUsed = matched.filter((id) =>
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
        matchedIngredients: matched.map(
          (id) =>
            allRequiredNames[allRequired.indexOf(id)] || id,
        ),
        missingIngredients: missing.map(
          (id) =>
            allRequiredNames[allRequired.indexOf(id)] || id,
        ),
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

    const topSuggestions = scoredRecipes.slice(0, limit);

    if (topSuggestions.length > 0 && topSuggestions.length <= 5) {
      try {
        const aiEnriched = await this.enrichSuggestionsWithAI(
          topSuggestions,
          inventoryNames,
          expiringItems.map((i) => i.name),
        );
        return aiEnriched;
      } catch (e) {
        this.logger.warn('AI enrichment failed, returning raw suggestions');
      }
    }

    return topSuggestions;
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
            content: `You are a waste segregation assistant for Indian households.
Classify kitchen waste into:
- "wet_waste": Biodegradable (vegetable peels, fruit scraps, leftover food, eggshells, tea leaves, coffee grounds)
- "dry_waste": Recyclable (plastic containers, foil, cardboard, glass jars, paper)
- "hazardous": Special disposal (cooking oil in bulk, batteries, medicines, chemical cleaners)

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
          'When unsure, food items generally go in wet waste (green bin).',
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
    ];

    if (wetKeywords.some((kw) => lower.includes(kw))) {
      if (packaging && ['plastic', 'foil', 'cardboard'].includes(packaging.toLowerCase())) {
        return {
          wasteType: WasteType.WET,
          confidence: 0.9,
          disposalTip: `The ${name} goes in wet waste (green bin). Separate the ${packaging} packaging into dry waste (blue bin).`,
        };
      }
      return {
        wasteType: WasteType.WET,
        confidence: 0.95,
        disposalTip: `${name} is biodegradable — put in wet waste (green bin). Can be composted!`,
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
}
