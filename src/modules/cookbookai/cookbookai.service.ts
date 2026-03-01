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

EXTERNAL LINK HANDLING — MULTI-STEP SEARCH STRATEGY

If the user provides a URL (YouTube, Instagram, website, blog, any recipe webpage):

STEP 1: Search for the EXACT URL using web_search_preview.
STEP 2: From the search results, extract the VIDEO TITLE / PAGE TITLE / RECIPE NAME.
STEP 3: Do a SECOND web_search_preview for: "<extracted title> recipe ingredients method"
         Example: if the video is titled "Butter Chicken", search for "Butter Chicken recipe ingredients method"
STEP 4: If Step 3 didn't return enough detail, do a THIRD search for: "<extracted title> full recipe"
STEP 5: Combine all search results to reconstruct the COMPLETE recipe.

CRITICAL RULES:
- The recipe you output MUST match what the URL is about. If the URL is about Chicken Butter Masala, output Chicken Butter Masala — NOT a salad, NOT a pasta, NOT any other dish.
- NEVER invent or hallucinate a recipe that doesn't match the URL content. If web search says the video is about "Butter Chicken Masala", your output MUST be Butter Chicken Masala.
- If after 3 searches you still can't find the recipe, search for: "<dish name from video title> authentic recipe"
- NEVER return a placeholder recipe saying "I can't access the video" or "waiting for your text".
- NEVER produce empty components, empty requiredIngredients, or filler steps.
- After extracting recipe data → call internal tools (getOrCreateIngredient etc.) for ALL ingredient IDs.
- If YouTube video → extract youtubeId from URL (the "v=" parameter or youtu.be slug).
- web_search_preview MUST NOT be used for ID lookups. Only for recipe content extraction.
- Preserve original recipe intent — don't simplify, invent steps, or change cuisine.

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
        this.logger.log('[extractRecipe] Using gpt-4o with web_search_preview');

        const result = await this.runAgenticLoop(message, {
            model: 'gpt-4o',
            tools: AI_TOOLS,
            reasoningEffort: null,   // gpt-4o doesn't use reasoning param
            maxOutputTokens: 16384,
        });

        if (result.success && this.isValidRecipe(result.data)) {
            this.logger.log('[extractRecipe] gpt-4o succeeded ✓');
            return result;
        }

        this.logger.error('[extractRecipe] gpt-4o failed or returned placeholder recipe.');
        return {
            success: false,
            message: 'Could not extract a valid recipe. Please try a different link.',
        };
    }

    /**
     * Check that a recipe object has meaningful content.
     */
    private isValidRecipe(data: any): boolean {
        if (!data || typeof data !== 'object') return false;
        const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;
        const hasComponents = Array.isArray(data.components) && data.components.length > 0;
        if (!hasTitle || !hasComponents) return false;

        // Check that at least one component has real ingredients (not placeholder)
        let totalIngredients = 0;
        for (const wrapper of data.components) {
            if (!Array.isArray(wrapper?.component)) continue;
            for (const comp of wrapper.component) {
                if (Array.isArray(comp?.requiredIngredients)) {
                    totalIngredients += comp.requiredIngredients.length;
                }
            }
        }
        if (totalIngredients === 0) {
            this.logger.warn('[isValidRecipe] Recipe has 0 ingredients — treating as invalid placeholder.');
            return false;
        }
        return true;
    }

    /**
     * Reusable agentic loop that works with any model + tools config.
     */
    private async runAgenticLoop(
        message: string,
        config: {
            model: string;
            tools: any[];
            reasoningEffort: string | null;
            maxOutputTokens: number;
        },
    ): Promise<{ success: boolean; message: string; data?: any }> {
        try {
            const tag = `[${config.model}]`;
            this.logger.log(`${tag} Starting agentic loop …`);

            const MAX_ITERATIONS = 25;
            const MAX_PARSE_RETRIES = 3;
            const MAX_NO_PROGRESS_ITERATIONS = 2;
            const MAX_TOTAL_MS = 180000;
            let iteration = 0;
            let parseRetries = 0;
            let noProgressIterations = 0;
            const startedAt = Date.now();

            const input: any[] = [{ role: 'user', content: message }];

            while (iteration < MAX_ITERATIONS) {
                if (Date.now() - startedAt > MAX_TOTAL_MS) {
                    this.logger.error(`${tag} Timed out by total time budget.`);
                    return {
                        success: false,
                        message: 'Recipe extraction timed out. Please try again.',
                    };
                }

                iteration++;
                this.logger.log(
                    `${tag} Iteration ${iteration}, input items: ${input.length}`,
                );

                // Build request params — only include reasoning for models that support it
                const params: any = {
                    model: config.model,
                    instructions: RECIPE_SYSTEM_PROMPT,
                    input,
                    tools: config.tools,
                    tool_choice: 'auto',
                    max_output_tokens: config.maxOutputTokens,
                };
                if (config.reasoningEffort) {
                    params.reasoning = { effort: config.reasoningEffort };
                }

                const response = await this.openai.responses.create(params);

                const output: any[] = (response as any).output ?? [];
                const outputTypes = output.map((i: any) => i.type).join(', ');
                this.logger.log(`${tag} Output types: ${outputTypes}`);

                // Push ALL output items back into input (required by Responses API)
                for (const item of output) {
                    input.push(item);
                }

                const functionCalls = output.filter(
                    (item: any) => item.type === 'function_call',
                );
                const hasWebSearch = output.some(
                    (item: any) =>
                        item.type === 'web_search_call' || item.type === 'web_search',
                );

                // ── If there are function calls, execute them ──
                if (functionCalls.length > 0) {
                    noProgressIterations = 0;
                    this.logger.log(
                        `${tag} ${functionCalls.length} function call(s): ` +
                            functionCalls.map((fc: any) => fc.name).join(', '),
                    );

                    for (const fc of functionCalls) {
                        const result = await this.handleToolCall(fc.name, fc.arguments);
                        this.logger.log(
                            `${tag} ${fc.name} → ${JSON.stringify(result).substring(0, 200)}`,
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
                const finalText = this.extractResponseText(response, output);

                if (!finalText.trim()) {
                    // Web search happened — model needs another iteration to process results
                    if (hasWebSearch) {
                        noProgressIterations = 0;
                        this.logger.log(
                            `${tag} Web search done, continuing for model to process results…`,
                        );
                        continue;
                    }

                    noProgressIterations++;
                    if (noProgressIterations > MAX_NO_PROGRESS_ITERATIONS) {
                        this.logger.error(
                            `${tag} No-progress iterations exceeded (${MAX_NO_PROGRESS_ITERATIONS}).`,
                        );
                        return {
                            success: false,
                            message: 'AI could not produce recipe output. Please try another link.',
                        };
                    }

                    this.logger.error(`${tag} Empty output. Types: ${outputTypes}`);
                    continue;
                }

                // ── Try to parse the final JSON ──
                const parsed = this.extractJsonFromText(finalText);
                if (parsed) {
                    const recipe = parsed.recipe ?? parsed;
                    // Validate before declaring success
                    if (this.isValidRecipe(recipe)) {
                        return {
                            success: true,
                            message: 'Recipe extracted successfully.',
                            data: recipe,
                        };
                    }
                    // Parsed but empty — ask model to try harder
                    this.logger.warn(
                        `${tag} Parsed JSON but recipe has no title/components. Asking model to regenerate.`,
                    );
                    input.push({
                        role: 'user',
                        content:
                            'The JSON you produced has an empty title or empty components array. Please produce the COMPLETE recipe JSON with a real title and at least 3 components. Output ONLY raw JSON.',
                    });
                    parseRetries++;
                    if (parseRetries >= MAX_PARSE_RETRIES) break;
                    continue;
                }

                // Parse failed — ask the model to fix its output
                noProgressIterations = 0;
                parseRetries++;
                if (parseRetries >= MAX_PARSE_RETRIES) {
                    this.logger.error(
                        `${tag} JSON parse failed after ${MAX_PARSE_RETRIES} retries.`,
                    );
                    return {
                        success: false,
                        message: 'AI returned invalid JSON. Please try another link.',
                    };
                }

                this.logger.warn(
                    `${tag} JSON parse failed, asking model to fix. Raw (first 500): ` +
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
            this.logger.error(`[${config.model}] Exceeded max iterations without completing.`);
            return {
                success: false,
                message: 'Recipe extraction timed out. Please try again.',
            };
        } catch (error: any) {
            this.logger.error(`[${config.model}] extraction failed:`, error?.message ?? error);
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
                message: `Failed to extract recipe. ${error?.message || 'Please try again.'}`,
            };
        }
    }

    private extractResponseText(response: any, output: any[]): string {
        const directText = typeof response?.output_text === 'string' ? response.output_text.trim() : '';
        if (directText) return directText;

        let finalText = '';
        for (const item of output || []) {
            if (item?.type !== 'message' || !Array.isArray(item?.content)) continue;
            for (const content of item.content) {
                if (content?.type === 'output_text' && typeof content?.text === 'string') {
                    finalText += content.text;
                } else if (content?.type === 'text' && typeof content?.text === 'string') {
                    finalText += content.text;
                }
            }
        }
        return finalText.trim();
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
           
        }

        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1].trim());
            } catch {
               
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

        if (data.stickerId && !isOid(data.stickerId)) data.stickerId = undefined;
        if (data.sponsorId && !isOid(data.sponsorId)) data.sponsorId = undefined;

        if (Array.isArray(data.components)) {
            for (const wrapper of data.components) {
                if (!Array.isArray(wrapper.component)) continue;
                for (const comp of wrapper.component) {
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
                        comp.requiredIngredients = comp.requiredIngredients.filter(
                            (ri: any) => ri.recommendedIngredient,
                        );
                    }
                    if (Array.isArray(comp.optionalIngredients)) {
                        comp.optionalIngredients = comp.optionalIngredients.filter(
                            (oi: any) => oi.ingredient && isOid(oi.ingredient),
                        );
                    }
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
