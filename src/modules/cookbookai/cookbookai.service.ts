import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import { userRecipe, UserRecipeDocument } from 'src/database/schemas/user.schema';
import { Ingredient, IngredientDocument } from 'src/database/schemas/ingredient.schema';
import {
    IngredientsCategory,
    IngredientsCategoryDocument,
} from 'src/database/schemas/ingredinats.Category.schema';
import { HackOrTip } from 'src/database/schemas/hack-or-tip.schema';
import {
    FrameworkCategory,
    FrameworkCategoryDocument,
} from 'src/database/schemas/framework-category.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';

const RECIPE_SYSTEM_PROMPT = `
You are a Recipe Construction Agent designed to generate structured recipe JSON compliant with the Recipe Schema.
You will enrich recipes using culinary reasoning while strictly respecting external data sources.

CRITICAL ID RULES — READ CAREFULLY

- Every ingredient, hack, tip, category, and recipe reference in your JSON MUST be a real MongoDB ObjectId string like "695a9033378ff7d2107e6f35".
- You get these IDs ONLY from tool call responses.
- NEVER use placeholder strings like "ingredient_id_paneer", "category_id_dinner", "" or any invented text.
- NEVER use an empty string "" as an ingredient ID.

INGREDIENT RULE (MOST IMPORTANT)

For EVERY ingredient in the recipe, you MUST call:
   getOrCreateIngredient(name: "Paneer", categoryName: "Dairy")

This tool ALWAYS returns a real MongoDB _id. It searches the database first.
If the ingredient does not exist, it auto-creates it and returns the new _id.
You will NEVER get an empty result. You ALWAYS get back {_id, name}.

Use the returned "_id" value directly in:
  - recommendedIngredient
  - alternativeIngredients[].ingredient
  - optionalIngredients[].ingredient
  - componentSteps[].relevantIngredients[]

Call this tool ONCE for EACH unique ingredient. Do NOT skip any ingredient.
Do NOT reuse the same _id for different ingredients.

CORE BEHAVIOR RULES

1. You MUST NOT invent IDs or fabricate database records.
2. For hacks, tips, categories, and recipes → use the respective lookup tools.
3. If hack/tip or category lookup returns empty:
   -> DO NOT add fabricated IDs.
   -> Add missing item to "missingSuggestions" section.
4. Only "useLeftoversIn" requires recipe lookup.
5. Do not output tool responses directly.
6. Do not hallucinate brand names, chef names, copyrighted text.
7. Your FINAL output must be ONLY raw JSON. No markdown, no code fences, no commentary.

EXTERNAL LINK HANDLING

If the user provides a URL (YouTube, Instagram, website, blog, any recipe webpage):

1. IMMEDIATELY use web_search_preview to search for that EXACT URL and extract the recipe content.
   - For YouTube: search for the exact YouTube URL to find the video title, description, and recipe
   - For Instagram: search for the exact Instagram URL
   - For websites/blogs: search for the exact URL to extract the recipe
2. After web_search_preview returns results, reconstruct the FULL recipe into the JSON schema.
3. Preserve original recipe intent — don't simplify, invent steps, or change cuisine.
4. web_search_preview MUST NOT be used for ID lookups. Only for recipe content extraction.
5. After extracting recipe data → call internal tools (getOrCreateIngredient etc.) for all IDs.
6. If YouTube video → extract youtubeId from URL (the "v=" parameter or youtu.be slug).
7. If web_search_preview fails to find the recipe → try searching for the recipe title + "recipe" as a fallback.
8. NEVER skip the web_search_preview step for URLs — always try to get the actual recipe data first.

TOOLS AVAILABLE

1. getOrCreateIngredient(name, categoryName?)
   → ALWAYS returns {_id, name}. Auto-creates if not in DB.
   → Call ONCE per unique ingredient name.
   → categoryName is optional: "Dairy", "Vegetables", "Spices", "Meat", "Grains", "Oils & Fats", "Herbs", "Condiments", "Fruits", "Nuts & Seeds", etc.

2. getHacksOrTips(query) → returns [{_id, title, shortDescription}]
3. getFrameworkCategories(query) → returns [{_id, title}] (e.g. "Lunch", "Dinner", "Breakfast")
4. getRecipes(query) → returns [{_id, title}] for useLeftoversIn
5. web_search_preview → ONLY for extracting recipe content from URLs

FINAL OUTPUT FORMAT

Output ONLY raw JSON (no markdown, no fences, no text before/after):

{
  "recipe": {
    "title": "string",
    "shortDescription": "string",
    "longDescription": "string",
    "hackOrTipIds": [],
    "heroImageUrl": "",
    "youtubeId": "",
    "portions": "3-4 servings",
    "prepCookTime": 30,
    "stickerId": "",
    "frameworkCategories": [],
    "sponsorId": "",
    "fridgeKeepTime": "2 days",
    "freezeKeepTime": "1 month",
    "useLeftoversIn": [],
    "components": [
      {
        "prepShortDescription": "string",
        "prepLongDescription": "string",
        "variantTags": [],
        "stronglyRecommended": false,
        "choiceInstructions": "string",
        "buttonText": "string",
        "component": [
          {
            "componentTitle": "string",
            "componentInstructions": "string",
            "includedInVariants": [],
            "requiredIngredients": [
              {
                "recommendedIngredient": "REAL_MONGODB_OBJECTID",
                "quantity": "250g",
                "preparation": "cubed",
                "alternativeIngredients": []
              }
            ],
            "optionalIngredients": [],
            "componentSteps": [
              {
                "stepInstructions": "Heat oil in a pan...",
                "hackOrTipIds": [],
                "alwaysShow": true,
                "relevantIngredients": ["REAL_MONGODB_OBJECTID"]
              }
            ]
          }
        ]
      }
    ],
    "order": 42,
    "isActive": true
  },
  "missingSuggestions": {
    "ingredients": [],
    "hacksOrTips": []
  }
}

DEFAULT FIELD RULES

- heroImageUrl: ""
- youtubeId: "" (or video ID from YouTube URL)
- stickerId: ""
- sponsorId: ""
- hackOrTipIds: [] if not found
- frameworkCategories: [] if not found
- useLeftoversIn: []
- order: random 1-100
- isActive: true
- Include minimum 3-4 components in the component array
`.trim();

const AI_TOOLS: any[] = [
    {
        type: 'function',
        name: 'getOrCreateIngredient',
        description:
            'Find an ingredient by name in the database. If it does not exist, it auto-creates it. ALWAYS returns {_id, name}. You will never get an empty result. Call this ONCE per unique ingredient.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: "Exact ingredient name, e.g. 'Paneer', 'Tomato', 'Olive Oil'",
                },
                categoryName: {
                    type: 'string',
                    description:
                        "Category: 'Dairy', 'Vegetables', 'Spices', 'Meat', 'Grains', 'Oils & Fats', 'Herbs', 'Condiments', 'Fruits', 'Nuts & Seeds', 'Seafood', etc.",
                },
            },
            required: ['name'],
        },
    },
    {
        type: 'function',
        name: 'getHacksOrTips',
        description:
            'Lookup hacks and tips by semantic query. Returns array of {_id, title, shortDescription}.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term for hacks or tips' },
            },
            required: ['query'],
        },
    },
    {
        type: 'function',
        name: 'getFrameworkCategories',
        description:
            'Lookup recipe framework categories (e.g. Lunch, Dinner, Breakfast). Returns array of {_id, title}.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: "Category search term like 'lunch', 'dinner', 'breakfast'",
                },
            },
            required: ['query'],
        },
    },
    {
        type: 'function',
        name: 'getRecipes',
        description:
            'Lookup existing recipes for the useLeftoversIn field. Returns array of {_id, title}.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Recipe search term' },
            },
            required: ['query'],
        },
    },
    {
        type: 'web_search_preview',
        search_context_size: 'high',
    },
];

@Injectable()
export class CookbookaiService {
    private readonly logger = new Logger(CookbookaiService.name);
    private readonly openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    constructor(
        @InjectModel(userRecipe.name)
        private readonly userRecipeModel: Model<UserRecipeDocument>,
        @InjectModel(Ingredient.name)
        private readonly ingredientModel: Model<IngredientDocument>,
        @InjectModel(IngredientsCategory.name)
        private readonly ingredientsCategoryModel: Model<IngredientsCategoryDocument>,
        @InjectModel(HackOrTip.name)
        private readonly hackOrTipModel: Model<any>,
        @InjectModel(FrameworkCategory.name)
        private readonly frameworkCategoryModel: Model<FrameworkCategoryDocument>,
        @InjectModel(Recipe.name)
        private readonly recipeModel: Model<RecipeDocument>,
        private readonly configService: ConfigService,
    ) {}

    getHello(): string {
        return 'Hello World! from cook book ai';
    }


    async extractRecipeWithAI(message: string) {
        try {
            this.logger.log('Calling OpenAI gpt-5.2 (Responses API + agentic loop) …');

            const MAX_ITERATIONS = 12;
            const MAX_PARSE_RETRIES = 3;
            let iteration = 0;
            let parseRetries = 0;

            const input: any[] = [{ role: 'user', content: message }];

            while (iteration < MAX_ITERATIONS) {
                iteration++;
                this.logger.log(
                    `[extractRecipe] Iteration ${iteration}, input items: ${input.length}`,
                );

                const response = await this.openai.responses.create({
                    model: 'gpt-5.2',
                    instructions: RECIPE_SYSTEM_PROMPT,
                    input,
                    tools: AI_TOOLS,
                    tool_choice: 'auto',
                    reasoning: { effort: 'none' },
                    max_output_tokens: 12000,
                } as any);

                const output: any[] = (response as any).output ?? [];
                const outputTypes = output.map((i: any) => i.type).join(', ');
                this.logger.log(`[extractRecipe] Output types: ${outputTypes}`);

                for (const item of output) {
                    input.push(item);
                }

                const functionCalls = output.filter(
                    (item: any) => item.type === 'function_call',
                );
                const hasWebSearch = output.some(
                    (item: any) => item.type === 'web_search_call',
                );

                // ── If there are function calls, execute them ──
                if (functionCalls.length > 0) {
                    this.logger.log(
                        `[extractRecipe] ${functionCalls.length} function call(s): ` +
                            functionCalls.map((fc: any) => fc.name).join(', '),
                    );

                    for (const fc of functionCalls) {
                        const result = await this.handleToolCall(fc.name, fc.arguments);
                        this.logger.log(
                            `[extractRecipe] ${fc.name} → ${JSON.stringify(result).substring(0, 200)}`,
                        );
                        input.push({
                            type: 'function_call_output',
                            call_id: fc.call_id,
                            output:
                                typeof result === 'string'
                                    ? result
                                    : JSON.stringify(result),
                        });
                    }
                    // Continue loop — model will consume tool results on next iteration
                    continue;
                }

                // ── No function calls — check for final text ──
                let finalText = '';
                for (const item of output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        for (const content of item.content) {
                            if (content.type === 'output_text') {
                                finalText += content.text;
                            }
                        }
                    }
                }

                if (!finalText.trim()) {
                    // Web search happened — model needs another iteration to process results
                    if (hasWebSearch) {
                        this.logger.log(
                            '[extractRecipe] Web search done, continuing for model to process results…',
                        );
                        continue;
                    }
                    // Nothing useful — error
                    this.logger.error(
                        `[extractRecipe] Empty output. Types: ${outputTypes}`,
                    );
                    return {
                        success: false,
                        message: 'AI returned an empty response. Please try again.',
                    };
                }

                // ── Try to parse the final JSON ──
                const parsed = this.extractJsonFromText(finalText);
                if (parsed) {
                    const recipe = parsed.recipe ?? parsed;
                    return {
                        success: true,
                        message: 'Recipe extracted successfully.',
                        data: recipe,
                    };
                }

                // Parse failed — ask the model to fix its output
                parseRetries++;
                if (parseRetries >= MAX_PARSE_RETRIES) {
                    this.logger.error(
                        `[extractRecipe] JSON parse failed after ${MAX_PARSE_RETRIES} retries.`,
                    );
                    return {
                        success: false,
                        message: 'AI returned invalid JSON. Please try another link.',
                    };
                }

                this.logger.warn(
                    '[extractRecipe] JSON parse failed, asking model to fix. Raw (first 500): ' +
                        finalText.substring(0, 500),
                );
                input.push({
                    role: 'user',
                    content:
                        'Your previous output was not valid JSON. Please output ONLY the raw JSON object with no markdown code fences, no commentary, and no text before or after the JSON. Start with { and end with }.',
                });
                continue;
            }

            // Exhausted iterations
            this.logger.error('[extractRecipe] Exceeded max iterations without completing.');
            return {
                success: false,
                message: 'Recipe extraction timed out. Please try again.',
            };
        } catch (error: any) {
            this.logger.error('OpenAI recipe extraction failed:', error?.message ?? error);
            if (error?.status) this.logger.error('OpenAI HTTP status:', error.status);
            if (error?.error)
                this.logger.error('OpenAI error body:', JSON.stringify(error.error));

            if (error?.status === 429) {
                return {
                    success: false,
                    message:
                        'OpenAI rate limit reached. Please wait a minute and try again.',
                };
            }

            return {
                success: false,
                message: `Failed to extract recipe from the link. ${error?.message || 'Please try again.'}`,
            };
        }
    }

    // ==================== TOOL CALL DISPATCHER ====================

    private async handleToolCall(name: string, argsRaw: string): Promise<any> {
        let args: any;
        try {
            args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;
        } catch {
            return { error: `Invalid JSON arguments for tool ${name}` };
        }

        switch (name) {
            case 'getOrCreateIngredient':
                return this.toolGetOrCreateIngredient(args.name, args.categoryName);
            case 'getHacksOrTips':
                return this.toolGetHacksOrTips(args.query);
            case 'getFrameworkCategories':
                return this.toolGetFrameworkCategories(args.query);
            case 'getRecipes':
                return this.toolGetRecipes(args.query);
            default:
                this.logger.warn(`Unknown tool call: ${name}`);
                return { error: `Unknown tool: ${name}` };
        }
    }

    // ==================== TOOL HANDLERS ====================

    /** Find ingredient by name (case-insensitive). Auto-create if missing. */
    private async toolGetOrCreateIngredient(
        name: string,
        categoryName?: string,
    ): Promise<{ _id: string; name: string }> {
        try {
            // 1. Try to find existing ingredient
            const existing = await this.ingredientModel
                .findOne({ name: { $regex: new RegExp(`^${this.escapeRegex(name)}$`, 'i') } })
                .lean()
                .exec();

            if (existing) {
                return { _id: String(existing._id), name: existing.name };
            }

            // 2. Resolve or create category
            let categoryId: Types.ObjectId;
            const categorySearch = categoryName || 'Uncategorized';
            const existingCat = await this.ingredientsCategoryModel
                .findOne({
                    name: { $regex: new RegExp(`^${this.escapeRegex(categorySearch)}$`, 'i') },
                })
                .lean()
                .exec();

            if (existingCat) {
                categoryId = existingCat._id as Types.ObjectId;
            } else {
                const newCat = await this.ingredientsCategoryModel.create({ name: categorySearch });
                categoryId = newCat._id as Types.ObjectId;
                this.logger.log(`Created ingredient category: ${categorySearch}`);
            }

            // 3. Create ingredient with minimal required fields
            const newIngredient = await this.ingredientModel.create({
                name,
                averageWeight: 100,
                categoryId,
            });
            this.logger.log(`Created ingredient: ${name} (${newIngredient._id})`);

            return { _id: String(newIngredient._id), name: newIngredient.name };
        } catch (err: any) {
            this.logger.error(`toolGetOrCreateIngredient error for "${name}":`, err?.message);
            return { _id: '', name };
        }
    }

    /** Search hacks / tips by title (case-insensitive regex). */
    private async toolGetHacksOrTips(
        query: string,
    ): Promise<{ _id: string; title: string; shortDescription: string }[]> {
        try {
            const docs = await this.hackOrTipModel
                .find({
                    title: { $regex: new RegExp(this.escapeRegex(query), 'i') },
                    isActive: true,
                })
                .select('_id title shortDescription')
                .limit(10)
                .lean()
                .exec();
            return docs.map((d: any) => ({
                _id: String(d._id),
                title: d.title,
                shortDescription: d.shortDescription ?? '',
            }));
        } catch (err: any) {
            this.logger.error(`toolGetHacksOrTips error:`, err?.message);
            return [];
        }
    }

    /** Search framework categories by title. */
    private async toolGetFrameworkCategories(
        query: string,
    ): Promise<{ _id: string; title: string }[]> {
        try {
            const docs = await this.frameworkCategoryModel
                .find({
                    title: { $regex: new RegExp(this.escapeRegex(query), 'i') },
                    isActive: true,
                })
                .select('_id title')
                .limit(10)
                .lean()
                .exec();
            return docs.map((d: any) => ({ _id: String(d._id), title: d.title }));
        } catch (err: any) {
            this.logger.error(`toolGetFrameworkCategories error:`, err?.message);
            return [];
        }
    }

    /** Search recipes by title. */
    private async toolGetRecipes(query: string): Promise<{ _id: string; title: string }[]> {
        try {
            const docs = await this.recipeModel
                .find({
                    title: { $regex: new RegExp(this.escapeRegex(query), 'i') },
                    isActive: true,
                })
                .select('_id title')
                .limit(10)
                .lean()
                .exec();
            return docs.map((d: any) => ({ _id: String(d._id), title: d.title }));
        } catch (err: any) {
            this.logger.error(`toolGetRecipes error:`, err?.message);
            return [];
        }
    }

    private extractJsonFromText(text: string): any | null {
        if (!text) return null;

        const cleaned = text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .trim();

        try {
            return JSON.parse(cleaned);
        } catch {
            // continue
        }

        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1].trim());
            } catch {
                // continue
            }
        }

        const candidates: string[] = [];
        const starts: number[] = [];
        for (let i = 0; i < cleaned.length; i++) {
            if (cleaned[i] === '{') starts.push(i);
        }

        for (const start of starts) {
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let i = start; i < cleaned.length; i++) {
                const ch = cleaned[i];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === '{') depth++;
                if (ch === '}') {
                    depth--;
                    if (depth === 0) {
                        const candidate = cleaned.slice(start, i + 1).trim();
                        if (candidate.length > 2) candidates.push(candidate);
                        break;
                    }
                }
            }
        }

        candidates.sort((a, b) => b.length - a.length);
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch {
                // continue
            }
        }

        return null;
    }

    /** Escape special regex characters in a string. */

    private buildUserMatch(userId: string) {
        const normalized = String(userId || '').trim();
        if (!normalized) {
            return { userid: '__invalid_user__' };
        }

        const orConditions: any[] = [{ userid: normalized }];
        if (Types.ObjectId.isValid(normalized)) {
            orConditions.push({ userid: new Types.ObjectId(normalized) });
        }

        return { $or: orConditions };
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ==================== CRUD ====================

    async findAllByUser(userId: string) {
        const userMatch = this.buildUserMatch(userId);
        return await this.userRecipeModel
            .find(userMatch)
            .sort({ createdAt: -1 })
            .lean()
            .exec();
    }

    async findById(id: string, userId: string) {
        if (!Types.ObjectId.isValid(id)) return null;
        const userMatch = this.buildUserMatch(userId);
        return await this.userRecipeModel
            .findOne({ _id: new Types.ObjectId(id), ...userMatch })
            .lean()
            .exec();
    }

    async deleteRecipe(id: string, userId: string) {
        if (!Types.ObjectId.isValid(id)) {
            return { success: false, message: 'Invalid recipe ID.' };
        }
        const userMatch = this.buildUserMatch(userId);
        const recipe = await this.userRecipeModel.findOne({
            _id: new Types.ObjectId(id),
            ...userMatch,
        });
        if (!recipe) {
            return { success: false, message: 'Recipe not found.' };
        }
        await this.userRecipeModel.deleteOne({ _id: new Types.ObjectId(id) });
        return { success: true, message: 'Recipe deleted successfully.' };
    }

    /**
     * Safety-net sanitization before Mongoose save.
     * With tool calling the AI should return real ObjectIds, but we guard against
     * any remaining plain-text strings that would cause CastErrors.
     */
    private sanitizeRecipeData(data: any): any {
        const isOid = (v: any) => Types.ObjectId.isValid(v) && String(new Types.ObjectId(v)) === String(v);

        // Top-level ObjectId[] fields — keep only valid ObjectIds
        for (const key of ['frameworkCategories', 'hackOrTipIds', 'useLeftoversIn'] as const) {
            if (Array.isArray(data[key])) {
                data[key] = data[key].filter(isOid);
            } else {
                data[key] = [];
            }
        }

        // Strip non-ObjectId stickerId / sponsorId
        if (data.stickerId && !isOid(data.stickerId)) data.stickerId = undefined;
        if (data.sponsorId && !isOid(data.sponsorId)) data.sponsorId = undefined;

        if (Array.isArray(data.components)) {
            for (const wrapper of data.components) {
                if (!Array.isArray(wrapper.component)) continue;
                for (const comp of wrapper.component) {
                    // requiredIngredients
                    if (Array.isArray(comp.requiredIngredients)) {
                        for (const ri of comp.requiredIngredients) {
                            if (ri.recommendedIngredient && !isOid(ri.recommendedIngredient)) {
                                ri.recommendedIngredient = undefined;
                            }
                            if (Array.isArray(ri.alternativeIngredients)) {
                                ri.alternativeIngredients = ri.alternativeIngredients.filter(
                                    (ai: any) => ai.ingredient && isOid(ai.ingredient),
                                );
                            }
                        }
                        // Remove entries with no valid ingredient
                        comp.requiredIngredients = comp.requiredIngredients.filter(
                            (ri: any) => ri.recommendedIngredient,
                        );
                    }
                    // optionalIngredients
                    if (Array.isArray(comp.optionalIngredients)) {
                        comp.optionalIngredients = comp.optionalIngredients.filter(
                            (oi: any) => oi.ingredient && isOid(oi.ingredient),
                        );
                    }
                    // componentSteps
                    if (Array.isArray(comp.componentSteps)) {
                        for (const step of comp.componentSteps) {
                            if (Array.isArray(step.relevantIngredients)) {
                                step.relevantIngredients = step.relevantIngredients.filter(isOid);
                            } else {
                                step.relevantIngredients = [];
                            }
                            if (Array.isArray(step.hackOrTipIds)) {
                                step.hackOrTipIds = step.hackOrTipIds.filter(isOid);
                            } else {
                                step.hackOrTipIds = [];
                            }
                        }
                    }
                }
            }
        }
        return data;
    }

    async createRecipe(recipeData: any) {
        try {
            const sanitized = this.sanitizeRecipeData(recipeData);
            const data = await this.userRecipeModel.create(sanitized);
            return {
                success: true,
                message: 'Recipe created successfully.',
                data: data,
            };
        } catch (error) {
            console.error('Error creating recipe:', error);
            return {
                success: false,
                message: 'An error occurred while creating the recipe.',
            };
        }
    }
}
