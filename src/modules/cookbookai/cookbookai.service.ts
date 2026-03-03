import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import { userRecipe, UserRecipeDocument } from 'src/database/schemas/user.schema';
import { Ingredient, IngredientDocument } from 'src/database/schemas/ingredient.schema';
import { HackOrTip } from 'src/database/schemas/hack-or-tip.schema';
import {
    FrameworkCategory,
    FrameworkCategoryDocument,
} from 'src/database/schemas/framework-category.schema';
import { Recipe, RecipeDocument } from 'src/database/schemas/recipe.schema';

const SYSTEM_PROMPT = `
You are a Recipe Construction Agent designed to generate structured recipe JSON.

====================
CRITICAL ID RULES
====================
- Every ingredient, hack, tip, category, and recipe reference MUST be a real MongoDB ObjectId from tool responses.
- NEVER use placeholder strings like "ingredient_id_paneer", "" or invented text.
- NEVER use an empty string "" as an ID.

====================
INGREDIENT RULE (MOST IMPORTANT)
====================
For EVERY ingredient in the recipe, call: searchIngredient(name: "Paneer")
- It returns {_id, name} if found, or {_id: null, name} if not found.
- If _id is returned (not null), use it as the ingredient reference AND include the name in "ingredientName".
- If _id is null, OMIT the id field and ONLY include name in "ingredientName".
- Call ONCE per unique ingredient. Do NOT reuse the same _id for different ingredients.

====================
CORE BEHAVIOR RULES
====================
1. NEVER invent IDs or fabricate database records.
2. For hacks, tips, categories, recipes → use the respective lookup tools.
3. If lookup returns empty → add to "missingSuggestions" section.
4. Final output: ONLY raw JSON. No markdown, no code fences, no commentary.
5. NEVER hallucinate brand names, chef names, copyrighted text.

====================
URL HANDLING (YouTube, Instagram, any URL)
====================
If the user provides a URL:
1. IMMEDIATELY use web_search to search for that EXACT URL and extract the recipe content.
2. For YouTube: search the exact URL to find title, description, recipe. Extract youtubeId from "v=" param or youtu.be slug.
3. For Instagram: search the exact URL to find the post content and recipe.
4. After web_search, reconstruct the FULL recipe into the JSON schema.
5. Preserve original recipe intent — don't simplify, invent steps, or change cuisine.
6. After extracting recipe data → call internal tools (searchIngredient etc.) for all IDs.
7. If first web_search fails → try searching "<recipe title> recipe" as fallback.
8. NEVER skip web_search for URLs.

====================
TOOLS AVAILABLE
====================
1. searchIngredient(name) → returns {_id, name} if found, {_id: null, name} if not. Search-only, does NOT create.
2. getHacksOrTips(query) → returns [{_id, title, shortDescription}]
3. getFrameworkCategories(query) → returns [{_id, title}] (e.g. "Lunch", "Dinner")
4. getRecipes(query) → returns [{_id, title}] for useLeftoversIn
5. web_search → ONLY for extracting recipe content from URLs

====================
OUTPUT FORMAT
====================
Output ONLY raw JSON (no markdown, no fences, no text before/after):
{
  "recipe": {
    "title": "", "shortDescription": "", "longDescription": "",
    "hackOrTipIds": [], "heroImageUrl": "", "youtubeId": "",
    "portions": "3-4 servings", "prepCookTime": 30, "stickerId": "", "frameworkCategories": [],
    "sponsorId": "", "fridgeKeepTime": "2 days", "freezeKeepTime": "1 month", "useLeftoversIn": [],
    "components": [{
      "prepShortDescription": "", "prepLongDescription": "", "variantTags": [],
      "stronglyRecommended": false, "choiceInstructions": "", "buttonText": "",
      "component": [{
        "componentTitle": "", "componentInstructions": "", "includedInVariants": [],
        "requiredIngredients": [{ "recommendedIngredient": "REAL_OID_OR_OMIT", "ingredientName": "Name", "quantity": "", "preparation": "", "alternativeIngredients": [] }],
        "optionalIngredients": [],
        "componentSteps": [{ "stepInstructions": "", "hackOrTipIds": [], "alwaysShow": true, "relevantIngredients": [] }]
      }]
    }],
    "order": 42, "isActive": true
  },
  "missingSuggestions": { "ingredients": [], "hacksOrTips": [] }
}

DEFAULTS: heroImageUrl="", stickerId="", sponsorId="", hackOrTipIds=[], frameworkCategories=[], useLeftoversIn=[], isActive=true. Include 3-4 components minimum.
`.trim();


const TOOLS: any[] = [
    {
        type: 'function',
        name: 'searchIngredient',
        description:
            'Search for an ingredient by name in the database. Returns {_id, name} if found, or {_id: null, name} if not found. Does NOT create ingredients. Call ONCE per unique ingredient.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: "Exact ingredient name, e.g. 'Paneer', 'Tomato', 'Olive Oil'",
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
                query: { type: 'string', description: "Category search term like 'lunch', 'dinner'" },
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


const INGREDIENT_ALIASES: Record<string, string[]> = {
    capsicum: ['bell pepper', 'sweet pepper'],
    'bell pepper': ['capsicum'],
    cilantro: ['coriander', 'coriander leaves', 'dhania'],
    coriander: ['cilantro', 'coriander leaves'],
    eggplant: ['aubergine', 'brinjal', 'baingan'],
    aubergine: ['eggplant', 'brinjal'],
    zucchini: ['courgette'],
    courgette: ['zucchini'],
    scallion: ['spring onion', 'green onion'],
    'spring onion': ['scallion', 'green onion'],
    chickpea: ['garbanzo', 'chana'],
    garbanzo: ['chickpea', 'chana'],
    cornstarch: ['corn flour', 'cornflour', 'corn starch'],
    'corn flour': ['cornstarch', 'cornflour'],
    'heavy cream': ['double cream', 'whipping cream'],
    prawn: ['shrimp'],
    shrimp: ['prawn'],
    'baking soda': ['bicarbonate of soda', 'bicarb'],
    'plain flour': ['all purpose flour', 'all-purpose flour', 'maida'],
    'all purpose flour': ['plain flour', 'maida'],
    paneer: ['cottage cheese', 'indian cottage cheese'],
    'cottage cheese': ['paneer'],
    yogurt: ['yoghurt', 'curd', 'dahi'],
    yoghurt: ['yogurt', 'curd'],
    curd: ['yogurt', 'yoghurt', 'dahi'],
    chili: ['chilli', 'chile'],
    chilli: ['chili', 'chile'],
};


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
        this.logger.log(`[extractRecipe] Starting for: ${message.substring(0, 120)}…`);

        try {
            const result = await this.runAgentLoop(message);
            if (result.success) {
                this.logger.log(`[extractRecipe] ✓ "${result.data?.title}"`);
            } else {
                this.logger.error(`[extractRecipe] ✗ ${result.message}`);
            }
            return result;
        } catch (err: any) {
            this.logger.error(`[extractRecipe] Unexpected error:`, err?.message);
            return {
                success: false,
                message: `Failed to extract recipe. ${err?.message || 'Please try again.'}`,
            };
        }
    }


    private async runAgentLoop(
        message: string,
    ): Promise<{ success: boolean; message: string; data?: any }> {
        const MAX_ITERATIONS = 25;
        let iteration = 0;

        const input: any[] = [
            { role: 'user', content: message },
        ];

        while (iteration < MAX_ITERATIONS) {
            iteration++;
            this.logger.log(`[agent] Iteration ${iteration}, input items: ${input.length}`);

            let response: any;
            try {
                response = await this.openai.responses.create({
                    model: 'gpt-4o',
                    instructions: SYSTEM_PROMPT,
                    input,
                    tools: TOOLS,
                    tool_choice: 'auto',
                    max_output_tokens: 16384,
                });
            } catch (err: any) {
                if (err?.status === 429) {
                    this.logger.warn('[agent] 429 rate-limited, waiting 3s…');
                    await new Promise(r => setTimeout(r, 3000));
                    try {
                        response = await this.openai.responses.create({
                            model: 'gpt-4o',
                            instructions: SYSTEM_PROMPT,
                            input,
                            tools: TOOLS,
                            tool_choice: 'auto',
                            max_output_tokens: 16384,
                        });
                    } catch {
                        return { success: false, message: 'OpenAI rate limit. Please wait a minute and try again.' };
                    }
                } else {
                    throw err;
                }
            }

            const output: any[] = (response as any).output ?? [];
            const outputTypes = output.map((i: any) => i.type).join(', ');
            this.logger.log(`[agent] Output types: ${outputTypes}`);

            for (const item of output) {
                input.push(item);
            }

            const functionCalls = output.filter((item: any) => item.type === 'function_call');
            const hasWebSearch = output.some(
                (item: any) => item.type === 'web_search_call' || item.type === 'web_search_preview_call',
            );

            if (functionCalls.length > 0) {
                for (const fc of functionCalls) {
                    let args: any = {};
                    try { args = JSON.parse(fc.arguments); } catch { args = {}; }

                    this.logger.log(`[agent] Tool: ${fc.name}(${JSON.stringify(args).substring(0, 150)})`);

                    let result: any;
                    try {
                        result = await this.handleToolCall(fc.name, args);
                    } catch (err: any) {
                        this.logger.error(`[agent] Tool ${fc.name} error:`, err?.message);
                        result = { error: `Failed: ${err?.message}` };
                    }

                    this.logger.log(`[agent] → ${JSON.stringify(result).substring(0, 200)}`);

                    input.push({
                        type: 'function_call_output',
                        call_id: fc.call_id,
                        output: JSON.stringify(result),
                    });
                }
                continue;
            }

            // ── No function calls — check for final text ──
            let finalText = '';
            for (const item of output) {
                if (item.type === 'message') {
                    for (const content of item.content || []) {
                        if (content.type === 'output_text') {
                            finalText += content.text;
                        }
                    }
                }
            }

            if (!finalText.trim()) {
                if (hasWebSearch) {
                    this.logger.log('[agent] Web search done, continuing…');
                    continue;
                }
                this.logger.warn(`[agent] Empty output. Types: ${outputTypes}`);
                continue;
            }

            try {
                const { recipe } = this.extractRecipePayload(finalText);
                return { success: true, message: 'Recipe extracted successfully.', data: recipe };
            } catch {
                this.logger.warn(`[agent] JSON parse failed, asking model to fix. Raw: ${finalText.substring(0, 500)}`);
                input.push({
                    role: 'user',
                    content: 'Your previous output was not valid JSON. Please output ONLY the raw JSON object with no markdown code fences, no commentary, and no text before or after the JSON. Start with { and end with }.',
                });
                continue;
            }
        }

        return { success: false, message: 'Recipe extraction exceeded max iterations. Please try again.' };
    }

    private async handleToolCall(name: string, args: any): Promise<any> {
        switch (name) {
            case 'searchIngredient':
                return this.toolSearchIngredient(args.name);
            case 'getHacksOrTips':
                return this.toolGetHacksOrTips(args.query);
            case 'getFrameworkCategories':
                return this.toolGetFrameworkCategories(args.query);
            case 'getRecipes':
                return this.toolGetRecipes(args.query);
            default:
                return { error: `Unknown tool: ${name}` };
        }
    }

    private async toolSearchIngredient(name: string): Promise<{ _id: string | null; name: string }> {
        try {
            const trimmed = String(name || '').trim();
            if (!trimmed || trimmed.length < 2) return { _id: null, name: trimmed };

            const queryLower = trimmed.toLowerCase();

            const exact = await this.ingredientModel
                .findOne({ name: { $regex: new RegExp(`^${this.escapeRegex(trimmed)}$`, 'i') } })
                .select('_id name').lean().exec();
            if (exact) return { _id: String(exact._id), name: exact.name };

            const contains = await this.ingredientModel
                .find({ name: { $regex: new RegExp(this.escapeRegex(trimmed), 'i') } })
                .select('_id name').limit(5).lean().exec();
            if (contains.length > 0) {
                const best = contains.sort((a, b) => a.name.length - b.name.length)[0];
                return { _id: String(best._id), name: best.name };
            }

            const aliases = INGREDIENT_ALIASES[queryLower] || [];
            for (const alias of aliases) {
                const found = await this.ingredientModel
                    .findOne({ name: { $regex: new RegExp(`^${this.escapeRegex(alias)}$`, 'i') } })
                    .select('_id name').lean().exec();
                if (found) return { _id: String(found._id), name: found.name };
            }
            for (const alias of aliases) {
                const partial = await this.ingredientModel
                    .findOne({ name: { $regex: new RegExp(this.escapeRegex(alias), 'i') } })
                    .select('_id name').lean().exec();
                if (partial) return { _id: String(partial._id), name: partial.name };
            }

            const words = trimmed.split(/[\s\-_,&+]+/).map(w => w.trim().toLowerCase()).filter(w => w.length >= 2);
            if (words.length > 0) {
                const allVariants = words.flatMap(w => this.wordVariants(w));
                const pattern = [...new Set(allVariants)].map(v => this.escapeRegex(v)).join('|');
                const fuzzy = await this.ingredientModel
                    .find({ name: { $regex: new RegExp(pattern, 'i') } })
                    .select('_id name').limit(20).lean().exec();

                if (fuzzy.length > 0) {
                    const scored = fuzzy.map(r => {
                        const nl = r.name.toLowerCase();
                        let score = 0;
                        for (const w of words) {
                            if (this.wordVariants(w).some(v => nl.includes(v))) score += 3;
                        }
                        const nw = r.name.toLowerCase().split(/[\s\-_,&+]+/).filter(x => x.length >= 2);
                        for (const n of nw) {
                            if (this.wordVariants(n).some(v => queryLower.includes(v))) score += 2;
                        }
                        score -= Math.abs(nw.length - words.length) * 0.5;
                        return { _id: String(r._id), name: r.name, score };
                    }).sort((a, b) => b.score - a.score);

                    if (scored[0].score >= 3) return { _id: scored[0]._id, name: scored[0].name };
                }
            }

            this.logger.log(`Ingredient not found: "${trimmed}"`);
            return { _id: null, name: trimmed };
        } catch (err: any) {
            this.logger.error(`toolSearchIngredient error for "${name}":`, err?.message);
            return { _id: null, name: String(name || '') };
        }
    }

    private wordVariants(word: string): string[] {
        const w = word.toLowerCase();
        const v = new Set<string>([w]);
        if (w.endsWith('ies') && w.length > 4) v.add(w.slice(0, -3) + 'y');
        else if (w.endsWith('ves') && w.length > 4) { v.add(w.slice(0, -3) + 'f'); v.add(w.slice(0, -3) + 'fe'); }
        else if (w.endsWith('ses') || w.endsWith('ches') || w.endsWith('shes')) v.add(w.slice(0, -2));
        else if (w.endsWith('es') && w.length > 4) v.add(w.slice(0, -2));
        else if (w.endsWith('s') && w.length > 3) v.add(w.slice(0, -1));
        if (!w.endsWith('s')) { v.add(w + 's'); if (w.endsWith('y') && w.length > 2) v.add(w.slice(0, -1) + 'ies'); }
        return [...v];
    }

    private async toolGetHacksOrTips(query: string): Promise<{ _id: string; title: string; shortDescription: string }[]> {
        try {
            const docs = await this.hackOrTipModel
                .find({ title: { $regex: new RegExp(this.escapeRegex(query), 'i') }, isActive: true })
                .select('_id title shortDescription').limit(10).lean().exec();
            return docs.map((d: any) => ({ _id: String(d._id), title: d.title, shortDescription: d.shortDescription ?? '' }));
        } catch (err: any) {
            this.logger.error(`toolGetHacksOrTips error:`, err?.message);
            return [];
        }
    }

    private async toolGetFrameworkCategories(query: string): Promise<{ _id: string; title: string }[]> {
        try {
            const docs = await this.frameworkCategoryModel
                .find({ title: { $regex: new RegExp(this.escapeRegex(query), 'i') }, isActive: true })
                .select('_id title').limit(10).lean().exec();
            return docs.map((d: any) => ({ _id: String(d._id), title: d.title }));
        } catch (err: any) {
            this.logger.error(`toolGetFrameworkCategories error:`, err?.message);
            return [];
        }
    }

    private async toolGetRecipes(query: string): Promise<{ _id: string; title: string }[]> {
        try {
            const docs = await this.recipeModel
                .find({ title: { $regex: new RegExp(this.escapeRegex(query), 'i') }, isActive: true })
                .select('_id title').limit(10).lean().exec();
            return docs.map((d: any) => ({ _id: String(d._id), title: d.title }));
        } catch (err: any) {
            this.logger.error(`toolGetRecipes error:`, err?.message);
            return [];
        }
    }

    private extractRecipePayload(raw: string): { recipe: any; missingSuggestions: any } {
        if (!raw) throw new Error('No recipe payload returned');

        let cleaned = raw.trim();

        const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
        if (fenceMatch) cleaned = fenceMatch[1].trim();

        if (!cleaned.startsWith('{')) {
            const idx = cleaned.indexOf('{');
            if (idx !== -1) cleaned = cleaned.substring(idx);
        }
        if (cleaned.includes('}')) {
            cleaned = cleaned.substring(0, cleaned.lastIndexOf('}') + 1);
        }

        cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
        cleaned = cleaned.replace(/\/\/[^\n]*/g, '');

        let parsed: any;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            try {
                parsed = JSON.parse(cleaned.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' '));
            } catch {
                this.logger.error('JSON parse failed. Cleaned (first 1000):', cleaned.substring(0, 1000));
                throw new Error('Recipe JSON returned by model is invalid');
            }
        }

        const recipe = parsed.recipe || parsed.json || parsed.data || parsed;
        const missingSuggestions = parsed.missingSuggestions || { ingredients: [], hacksOrTips: [] };
        return { recipe, missingSuggestions };
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private buildUserMatch(userId: string) {
        const normalized = String(userId || '').trim();
        if (!normalized) return { userid: '__invalid_user__' };
        const orConditions: any[] = [{ userid: normalized }];
        if (Types.ObjectId.isValid(normalized)) {
            orConditions.push({ userid: new Types.ObjectId(normalized) });
        }
        return { $or: orConditions };
    }

    async findAllByUser(userId: string) {
        return await this.userRecipeModel.find(this.buildUserMatch(userId)).sort({ createdAt: -1 }).lean().exec();
    }

    async findById(id: string, userId: string) {
        if (!Types.ObjectId.isValid(id)) return null;
        return await this.userRecipeModel.findOne({ _id: new Types.ObjectId(id), ...this.buildUserMatch(userId) }).lean().exec();
    }
  
    async deleteRecipe(id: string, userId: string) {
        if (!Types.ObjectId.isValid(id)) return { success: false, message: 'Invalid recipe ID.' };
        const recipe = await this.userRecipeModel.findOne({ _id: new Types.ObjectId(id), ...this.buildUserMatch(userId) });
        if (!recipe) return { success: false, message: 'Recipe not found.' };
        await this.userRecipeModel.deleteOne({ _id: new Types.ObjectId(id) });
        return { success: true, message: 'Recipe deleted successfully.' };
    }

    private sanitizeRecipeData(data: any): any {
        const isOid = (v: any) => Types.ObjectId.isValid(v) && String(new Types.ObjectId(v)) === String(v);

        for (const key of ['frameworkCategories', 'hackOrTipIds', 'useLeftoversIn'] as const) {
            data[key] = Array.isArray(data[key]) ? data[key].filter(isOid) : [];
        }

        if (data.stickerId && !isOid(data.stickerId)) data.stickerId = undefined;
        if (data.sponsorId && !isOid(data.sponsorId)) data.sponsorId = undefined;

        if (Array.isArray(data.components)) {
            for (const wrapper of data.components) {
                if (!Array.isArray(wrapper.component)) continue;
                for (const comp of wrapper.component) {
                    if (Array.isArray(comp.requiredIngredients)) {
                        for (const ri of comp.requiredIngredients) {
                            if (ri.recommendedIngredient && !isOid(ri.recommendedIngredient)) ri.recommendedIngredient = undefined;
                            if (Array.isArray(ri.alternativeIngredients)) {
                                for (const ai of ri.alternativeIngredients) {
                                    if (ai.ingredient && !isOid(ai.ingredient)) ai.ingredient = undefined;
                                }
                                ri.alternativeIngredients = ri.alternativeIngredients.filter(
                                    (ai: any) => (ai.ingredient && isOid(ai.ingredient)) || ai.ingredientName,
                                );
                            }
                        }
                        comp.requiredIngredients = comp.requiredIngredients.filter(
                            (ri: any) => ri.recommendedIngredient || ri.ingredientName,
                        );
                    }
                    if (Array.isArray(comp.optionalIngredients)) {
                        for (const oi of comp.optionalIngredients) {
                            if (oi.ingredient && !isOid(oi.ingredient)) oi.ingredient = undefined;
                        }
                        comp.optionalIngredients = comp.optionalIngredients.filter(
                            (oi: any) => (oi.ingredient && isOid(oi.ingredient)) || oi.ingredientName,
                        );
                    }
                    if (Array.isArray(comp.componentSteps)) {
                        for (const step of comp.componentSteps) {
                            step.relevantIngredients = Array.isArray(step.relevantIngredients) ? step.relevantIngredients.filter(isOid) : [];
                            step.hackOrTipIds = Array.isArray(step.hackOrTipIds) ? step.hackOrTipIds.filter(isOid) : [];
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
            return { success: true, message: 'Recipe created successfully.', data };
        } catch (error) {
            console.error('Error creating recipe:', error);
            return { success: false, message: 'An error occurred while creating the recipe.' };
        }
    }
}
