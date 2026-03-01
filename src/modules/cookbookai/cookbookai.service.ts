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

const CORE_PROMPT_RULES = `
You are a Recipe Construction Agent. Output structured recipe JSON.

ID RULES: Every ingredient/hack/tip/category/recipe ID MUST be a real MongoDB ObjectId from tool responses. NEVER invent IDs or use "".

INGREDIENT RULE: For EVERY ingredient, call getOrCreateIngredient(name, categoryName?). It ALWAYS returns {_id, name}. Call ONCE per unique ingredient.

ALTERNATIVES (MANDATORY): For EVERY requiredIngredient, provide 1-2 alternativeIngredients. For EVERY component, provide 2-3 optionalIngredients. Call getOrCreateIngredient for each. NEVER leave these empty.

CORE RULES:
- Use lookup tools for hacks/tips/categories/recipes. If empty → add to missingSuggestions.
- Final output: ONLY raw JSON. No markdown, no fences, no commentary.
- NEVER hallucinate, invent steps, or change the recipe's cuisine/intent.

TOOLS: getOrCreateIngredient, getHacksOrTips, getFrameworkCategories, getRecipes, web_search

OUTPUT FORMAT:
{
  "recipe": {
    "title": "", "shortDescription": "", "longDescription": "",
    "hackOrTipIds": [], "heroImageUrl": "", "youtubeId": "",
    "portions": "3-4 servings", "prepCookTime": 30, "stickerId": "", "frameworkCategories": [],
    "sponsorId": "", "fridgeKeepTime": "2 days", "freezeKeepTime": "1 month", "useLeftoversIn": [],
    "components": [{ "prepShortDescription": "", "prepLongDescription": "", "variantTags": [],
      "stronglyRecommended": false, "choiceInstructions": "", "buttonText": "",
      "component": [{ "componentTitle": "", "componentInstructions": "", "includedInVariants": [],
        "requiredIngredients": [{ "recommendedIngredient": "OID", "quantity": "", "preparation": "", "alternativeIngredients": [{ "ingredient": "OID", "inheritQuantity": true, "inheritPreparation": true }] }],
        "optionalIngredients": [{ "ingredient": "OID", "quantity": "", "preparation": "" }],
        "componentSteps": [{ "stepInstructions": "", "hackOrTipIds": [], "alwaysShow": true, "relevantIngredients": [] }]
      }]
    }],
    "order": 42, "isActive": true
  },
  "missingSuggestions": { "ingredients": [], "hacksOrTips": [] }
}

DEFAULTS: heroImageUrl="", stickerId="", sponsorId="", hackOrTipIds=[], frameworkCategories=[], useLeftoversIn=[], isActive=true. Include 3-4 components minimum.
`.trim();

const YOUTUBE_SYSTEM_PROMPT = `${CORE_PROMPT_RULES}

URL HANDLING:
1. web_search the exact URL to get the title.
2. web_search "<title> recipe ingredients method" for full recipe.
3. If needed, web_search "<title> full recipe" for more detail.
- If YouTube → extract youtubeId from the "v=" param or youtu.be slug.
- Recipe MUST match the URL content. NEVER output a different dish.
`.trim();

const INSTAGRAM_SYSTEM_PROMPT = `${CORE_PROMPT_RULES}

SCRAPED CONTEXT PRIORITY:
If the message contains "--- SCRAPED INSTAGRAM CONTEXT ---", use that caption/author/description as your PRIMARY source to identify the dish. Then web_search "<dish name> recipe ingredients method steps" for full details.

FALLBACK (if no scraped context):
1. web_search the exact Instagram URL.
2. Extract USERNAME from URL → search "<username> instagram recipe".
3. Use any caption text/hashtags/dish name from results → search "<dish name> recipe ingredients method".
4. If the user message includes a dish name, use it directly.
5. Check URL keywords (e.g. "biryani") → search "<keyword> recipe full ingredients steps".
6. Last resort: "<username> popular recipe".

Try at least 3-4 different queries. Search for blog/YouTube mirrors of the post.
Recipe MUST match the URL. NEVER invent a different dish.
`.trim();


const FUNCTION_TOOLS: any[] = [
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
];

function buildAiTools(searchContextSize: 'medium' | 'high'): any[] {
    return [
        ...FUNCTION_TOOLS,
        {
            type: 'web_search',
            search_context_size: searchContextSize,
        },
    ];
}

let activeCalls = 0;
const MAX_CONCURRENT_AI = 3;
const waitQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
    if (activeCalls < MAX_CONCURRENT_AI) {
        activeCalls++;
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        waitQueue.push(() => {
            activeCalls++;
            resolve();
        });
    });
}

function releaseSlot(): void {
    activeCalls--;
    if (waitQueue.length > 0) {
        const next = waitQueue.shift()!;
        next();
    }
}

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

    private isInstagramMessage(message: string): boolean {
        const text = String(message || '').toLowerCase();
        return text.includes('instagram.com/') || text.includes('instagr.am/');
    }

  
    private extractInstagramUrl(message: string): string | null {
        const match = message.match(/https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s)"']+/i);
        return match ? match[0] : null;
    }

    private async scrapeInstagramContext(url: string): Promise<string | null> {
        const parts: string[] = [];

  
        try {
            const oEmbedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&omitscript=true`;
            const oRes = await fetch(oEmbedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Saveful/1.0)' },
                signal: AbortSignal.timeout(8000),
            });
            if (oRes.ok) {
                const data = await oRes.json();
                if (data.title) parts.push(`Post caption: ${data.title}`);
                if (data.author_name) parts.push(`Author: ${data.author_name}`);
                if (data.thumbnail_url) parts.push(`Thumbnail: ${data.thumbnail_url}`);
                this.logger.log(`[instagram-scrape] oEmbed OK — author: ${data.author_name}, caption length: ${(data.title || '').length}`);
            } else {
                this.logger.warn(`[instagram-scrape] oEmbed HTTP ${oRes.status}`);
            }
        } catch (err: any) {
            this.logger.warn(`[instagram-scrape] oEmbed failed: ${err?.message}`);
        }

        try {
            const htmlRes = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });
            if (htmlRes.ok) {
                const html = await htmlRes.text();

                const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
                if (ogTitle?.[1] && !parts.some(p => p.includes(ogTitle[1]))) {
                    parts.push(`Page title: ${ogTitle[1]}`);
                }

                const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
                if (ogDesc?.[1]) {
                    parts.push(`Description: ${ogDesc[1]}`);
                }

                if (!ogDesc?.[1]) {
                    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
                    if (metaDesc?.[1]) {
                        parts.push(`Description: ${metaDesc[1]}`);
                    }
                }

                const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
                if (jsonLdMatch?.[1]) {
                    try {
                        const ld = JSON.parse(jsonLdMatch[1]);
                        if (ld.name) parts.push(`Structured name: ${ld.name}`);
                        if (ld.description) parts.push(`Structured description: ${ld.description}`);
                        if (ld.articleBody) parts.push(`Article body: ${ld.articleBody.substring(0, 1000)}`);
                    } catch { /* ignore parse errors */ }
                }

                this.logger.log(`[instagram-scrape] HTML meta extracted — ${parts.length} context parts`);
            }
        } catch (err: any) {
            this.logger.warn(`[instagram-scrape] HTML fetch failed: ${err?.message}`);
        }

        if (parts.length === 0) {
            this.logger.warn('[instagram-scrape] No context could be scraped.');
            return null;
        }

        return parts.join('\n');
    }


    async extractRecipeWithAI(message: string) {
        const isInstagram = this.isInstagramMessage(message);
        this.logger.log(
            `[extractRecipe] Using gpt-5.2 with web_search (${isInstagram ? 'instagram-quality' : 'default-fast'} profile)`,
        );

        let enrichedMessage = message;
        if (isInstagram) {
            const igUrl = this.extractInstagramUrl(message);
            if (igUrl) {
                this.logger.log(`[extractRecipe] Scraping Instagram context from: ${igUrl}`);
                const scraped = await this.scrapeInstagramContext(igUrl);
                if (scraped) {
                    enrichedMessage = `${message}\n\n--- SCRAPED INSTAGRAM CONTEXT (use this as primary recipe source) ---\n${scraped}\n--- END SCRAPED CONTEXT ---`;
                    this.logger.log(`[extractRecipe] Injected ${scraped.length} chars of Instagram context`);
                }
            }
        }

        await acquireSlot();
        this.logger.log(`[extractRecipe] Slot acquired (active: ${activeCalls}/${MAX_CONCURRENT_AI})`);

        let result: any;
        try {
            result = await this.runAgenticLoop(enrichedMessage, {
                model: 'gpt-5.2',
                systemPrompt: isInstagram ? INSTAGRAM_SYSTEM_PROMPT : YOUTUBE_SYSTEM_PROMPT,
                tools: buildAiTools(isInstagram ? 'high' : 'medium'),
                reasoningEffort: isInstagram ? 'medium' : null,  
                maxOutputTokens: isInstagram ? 8000 : 5000,
                maxIterations: isInstagram ? 14 : 8,
                maxTotalMs: isInstagram ? 420000 : 180000,
            });
        } finally {
            releaseSlot();
            this.logger.log(`[extractRecipe] Slot released (active: ${activeCalls}/${MAX_CONCURRENT_AI})`);
        }

        if (result.success && this.isValidRecipe(result.data)) {
            this.logger.log('[extractRecipe] gpt-5.2 succeeded ✓');
            return result;
        }

        this.logger.error('[extractRecipe] gpt-5.2 failed or returned placeholder recipe.');
        return {
            success: false,
            message: 'Could not extract a valid recipe. Please try a different link.',
        };
    }

    private isValidRecipe(data: any): boolean {
        if (!data || typeof data !== 'object') return false;
        const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;
        const hasComponents = Array.isArray(data.components) && data.components.length > 0;
        if (!hasTitle || !hasComponents) return false;

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

    private async runAgenticLoop(
        message: string,
        config: {
            model: string;
            systemPrompt: string;
            tools: any[];
            reasoningEffort: string | null;
            maxOutputTokens: number;
            maxIterations?: number;
            maxTotalMs?: number;
        },
    ): Promise<{ success: boolean; message: string; data?: any }> {
        try {
            const tag = `[${config.model}]`;
            this.logger.log(`${tag} Starting agentic loop …`);

            const MAX_ITERATIONS = config.maxIterations ?? 10;
            const MAX_PARSE_RETRIES = 2;
            const MAX_NO_PROGRESS_ITERATIONS = 2;
            const MAX_TOTAL_MS = config.maxTotalMs ?? 300000;
            let iteration = 0;
            let parseRetries = 0;
            let noProgressIterations = 0;
            const startedAt = Date.now();

            const input: any[] = [
                { role: 'system', content: config.systemPrompt },
                { role: 'user', content: message },
            ];

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

                const params: any = {
                    model: config.model,
                    input,
                    tools: config.tools,
                    tool_choice: 'auto',
                    max_output_tokens: config.maxOutputTokens,
                };
                if (config.reasoningEffort) {
                    params.reasoning = { effort: config.reasoningEffort };
                }

                // Retry with exponential backoff on 429
                let response: any;
                for (let attempt = 0; attempt < 4; attempt++) {
                    try {
                        response = await this.openai.responses.create(params);
                        break;
                    } catch (err: any) {
                        if (err?.status === 429 && attempt < 3) {
                            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                            this.logger.warn(`${tag} 429 rate-limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }
                        throw err;
                    }
                }

                if ((response as any)?.usage) {
                    const u = (response as any).usage;
                    this.logger.log(
                        `${tag} Iter ${iteration} usage — prompt: ${u.input_tokens ?? u.prompt_tokens ?? '?'}, ` +
                        `completion: ${u.output_tokens ?? u.completion_tokens ?? '?'}, ` +
                        `total: ${u.total_tokens ?? '?'}`,
                    );
                }

                const output: any[] = (response as any).output ?? [];
                const outputTypes = output.map((i: any) => i.type).join(', ');
                this.logger.log(`${tag} Output types: ${outputTypes}`);

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
                    continue;
                }

                const finalText = this.extractResponseText(response, output);

                if (!finalText.trim()) {
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

                const parsed = this.extractJsonFromText(finalText);
                if (parsed) {
                    const recipe = parsed.recipe ?? parsed;
                    if (this.isValidRecipe(recipe)) {
                        return {
                            success: true,
                            message: 'Recipe extracted successfully.',
                            data: recipe,
                        };
                    }
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


    private async toolGetOrCreateIngredient(
        name: string,
        categoryName?: string,
    ): Promise<{ _id: string; name: string }> {
        try {
           
            const existing = await this.ingredientModel
                .findOne({ name: { $regex: new RegExp(`^${this.escapeRegex(name)}$`, 'i') } })
                .lean()
                .exec();

            if (existing) {
                return { _id: String(existing._id), name: existing.name };
            }

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
