import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import { YoutubeTranscript } from 'youtube-transcript';
import { userRecipe, UserRecipeDocument } from 'src/database/schemas/user.schema';

const EXTRACT_PROMPT = `You are a recipe extraction assistant. The user will provide a URL or recipe description.
You MUST use web search to look up the URL and extract the ACTUAL recipe from it.
Do NOT invent or generate a recipe from your training data. Extract ONLY what is on the page/video.
Describe the FULL recipe in plain text: title, description, ALL ingredients with exact quantities, ALL steps in detail, prep/cook time, portions, storage info.
For YouTube, also note the video ID from the URL. also revalidate the recipe from the video transcript if available for extra detail and add all necessary ingredients and steps mentioned in the video that may be missing from the web search.
If the recipe details are missing or unclear from the provided source, return exactly: SOURCE_INSUFFICIENT.
Be thorough — do not skip any ingredient or step. Output plain text, not JSON.`.trim();

const JSON_PROMPT = `Convert the recipe content below into a JSON object. Output ONLY valid JSON.

Required shape:
{
  "recipe": {
    "title": "",
    "shortDescription": "",
    "longDescription": "",
    "heroImageUrl": "",
    "youtubeId": "",
    "portions": "3-4 servings",
    "prepCookTime": 30,
    "fridgeKeepTime": "2 days",
    "freezeKeepTime": "1 month",
    "components": [
      {
        "prepShortDescription": "",
        "prepLongDescription": "",
        "variantTags": [],
        "stronglyRecommended": false,
        "choiceInstructions": "",
        "buttonText": "",
        "component": [
          {
            "componentTitle": "",
            "componentInstructions": "",
            "includedInVariants": [],
            "requiredIngredients": [
              {
                "ingredientName": "Main Ingredient",
                "quantity": "250g",
                "preparation": "diced",
                "alternativeIngredients": [
                  { "ingredientName": "Alt 1", "quantity": "", "preparation": "", "inheritQuantity": true, "inheritPreparation": true },
                  { "ingredientName": "Alt 2", "quantity": "", "preparation": "", "inheritQuantity": true, "inheritPreparation": true }
                ]
              }
            ],
            "optionalIngredients": [
              { "ingredientName": "Optional Add-in", "quantity": "1 tbsp", "preparation": "chopped" }
            ],
            "componentSteps": [
              { "stepInstructions": "", "alwaysShow": true }
            ]
          }
        ]
      }
    ],
    "isActive": true
  }
}

Rules:
- Use plain ingredient names as strings in ingredientName (e.g. "Paneer", "Olive Oil"). No IDs.
- Include 3-6 components minimum. Group logically: e.g. "Protein", "Liquid", "Cheese", "Extra Flavours", "Coating", "Oil/Cooking".
- For YouTube URLs, extract youtubeId it should be the id form the link provided,from "v=" param or youtu.be slug.
- heroImageUrl defaults to empty string.
- prepCookTime in minutes.

CRITICAL — ALTERNATIVE INGREDIENTS (VERY IMPORTANT):

Alternative ingredients MUST be logically compatible with the ingredient and the recipe context.

Rules:
- Alternatives must belong to the SAME ingredient category or serve the SAME culinary role.
- Never suggest substitutes that fundamentally change the recipe type.
- Avoid incompatible substitutions (e.g. Paneer for Egg in an omelette recipe, Beef for Chicken in vegetarian recipes, etc).
- Respect dietary context when obvious:
  - If recipe is vegetarian → alternatives must remain vegetarian
  - If recipe is vegan → alternatives must remain vegan
  - If recipe is gluten-free → avoid wheat alternatives
- Substitutes should be realistic kitchen swaps used by cooks.

Ingredient category guidelines:

Eggs:
- Good alternatives: liquid egg substitute, egg whites, tofu (ONLY when eggs are used as binding), chickpea flour batter
- Bad alternatives: paneer, chicken, beef

Milk / Dairy Liquids:
- Good alternatives: oat milk, almond milk, soy milk, coconut milk, stock
- Bad alternatives: yogurt, cheese, paneer

Cheese:
- Good alternatives: mozzarella, gouda, parmesan, gruyere, provolone
- Bad alternatives: paneer in western cheese recipes unless culturally relevant

Bread:
- Good alternatives: sourdough, wholegrain bread, brioche, ciabatta, gluten-free bread
- Bad alternatives: tortillas unless recipe allows wraps

Meat:
- Good alternatives: same category meats (chicken breast ↔ chicken thigh ↔ turkey)
- Plant alternatives only if logical (tofu, tempeh) but not random dairy or grains.

Vegetables:
- Alternatives should be similar texture and cooking behaviour.

Spices / Herbs:
- Use flavour-compatible swaps only (parsley ↔ cilantro ↔ basil).

EXTREMELY IMPORTANT:
Before suggesting alternatives, think about:
1. The role of the ingredient (protein, binder, fat, flavour, texture)
2. The cuisine type
3. The cooking technique

Only generate alternatives that a **real cook would reasonably use in that recipe**.
Avoid absurd substitutions.

CRITICAL — OPTIONAL INGREDIENTS:
- Each component can have optionalIngredients for extra flavour, garnish, or customization.
- Use a dedicated component for "Extra Flavours" or "Extras" with stronglyRecommended: true, choiceInstructions: "Mix and match, choose as many as you like", buttonText: "add your flavours".
- Include 10-30 optional ingredients for flavour customization (herbs, spices, vegetables, condiments, proteins etc.).
- Think broadly about what a cook might add: herbs (basil, cilantro, parsley, mint, rosemary, thyme), spices (cumin, paprika, chilli flakes, curry powder, garam masala), aromatics (garlic, ginger, onion, spring onion), add-ins (olives, sundried tomatoes, capers, anchovies, bacon, salami), vegetables (zucchini, spinach, bell pepper, mushrooms, corn), and condiments (lemon zest, soy sauce, worcestershire sauce).

COMPONENT STRUCTURE GUIDE:
- Component 1: Main base ingredient (e.g. "Bread", "Rice", "Pasta") with alternatives
- Component 2: Liquid/binding ingredient (e.g. "Liquid", "Sauce") with alternatives
- Component 3: "Extra Flavours" — stronglyRecommended: true, mostly optionalIngredients (10-30 items), choiceInstructions + buttonText set
- Component 4: Cooking medium (e.g. "Oil") with alternatives
- Add more components as needed for the recipe.

Each component's variantTags should include the recipe title. Each component[].includedInVariants should also include the recipe title.`.trim();


@Injectable()
export class CookbookaiService {
    private readonly logger = new Logger(CookbookaiService.name);
    private readonly openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    constructor(
        @InjectModel(userRecipe.name)
        private readonly userRecipeModel: Model<UserRecipeDocument>,
    ) {}

    getHello(): string {
        return 'Hello World! from cook book ai';
    }


    async extractRecipeWithAI(message: string) {
        this.logger.log(`[extractRecipe] Starting for: ${message.substring(0, 120)}…`);

        try {
            const result = await this.callAI(message);
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

    private hasUrl(message: string): boolean {
        return /(https?:\/\/|www\.)/i.test(String(message || ''));
    }

    private extractPrimaryUrl(message: string): string {
        const match = String(message || '').trim().match(/https?:\/\/[^\s]+/i);
        return match ? match[0].trim() : '';
    }

    private extractYoutubeVideoId(url: string): string | null {
        const patterns = [
            /(?:v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
            /(?:embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) return m[1];
        }
        return null;
    }

    private isYoutubeUrl(url: string): boolean {
        return /(?:youtube\.com|youtu\.be)/i.test(url);
    }

  
    private async fetchYoutubeTranscript(videoId: string): Promise<string> {
        try {
            this.logger.log(`[transcript] Fetching transcript for video: ${videoId}`);
            const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
            if (!transcriptItems || transcriptItems.length === 0) {
                this.logger.warn(`[transcript] No transcript found for ${videoId}`);
                return '';
            }
            const text = transcriptItems.map((item: any) => item.text).join(' ');
            this.logger.log(`[transcript] Got ${text.length} chars transcript for ${videoId}`);
            return text;
        } catch (err: any) {
            this.logger.warn(`[transcript] Failed for ${videoId}: ${err?.message}`);
            return '';
        }
    }


    private async fetchRecipeContent(url: string, model: 'gpt-4o-mini' | 'gpt-4o'): Promise<string> {
        this.logger.log(`[stage1] Fetching recipe content with ${model} for ${url.substring(0, 80)}`);
        const response: any = await this.openai.responses.create({
            model,
            instructions: EXTRACT_PROMPT,
            input: [{ role: 'user', content: `Use web search to find and extract the EXACT recipe from this URL: ${url}\nDo NOT make up a recipe. Only return what you find from searching this URL. If insufficient evidence from this exact URL context, return SOURCE_INSUFFICIENT.` }],
            tools: [{ type: 'web_search' }],
            tool_choice: 'required',
            max_output_tokens: 4096,
        });
        // Read text from Responses API output
        const text = typeof response?.output_text === 'string'
            ? response.output_text
            : (response?.output ?? [])
                .filter((i: any) => i.type === 'message')
                .flatMap((i: any) => i.content || [])
                .filter((c: any) => c.type === 'output_text')
                .map((c: any) => c.text)
                .join('');
        this.logger.log(`[stage1] Got ${text.length} chars from ${model}`);
        return text;
    }

    // ── Stage 2: JSON structuring via Chat Completions API (guaranteed JSON) ──

    private async structureAsJson(recipeText: string, model: 'gpt-4o-mini' | 'gpt-4o'): Promise<any> {
        this.logger.log(`[stage2] Structuring JSON with ${model} (${recipeText.length} chars input)`);
        const completion = await this.openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: JSON_PROMPT },
                { role: 'user', content: recipeText.substring(0, 32000) },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 16384,
            temperature: 0.3,
        });
        const raw = completion.choices?.[0]?.message?.content ?? '';
        this.logger.log(`[stage2] Got ${raw.length} chars JSON from ${model}`);
        const parsed = JSON.parse(raw); 
        return parsed.recipe || parsed;
    }


    private normalizeRecipeShape(recipe: any): any {
        const safe = recipe && typeof recipe === 'object' ? recipe : {};
        safe.title = String(safe.title || 'Generated Recipe');
        safe.shortDescription = String(safe.shortDescription || 'Recipe generated from your link');
        safe.longDescription = String(safe.longDescription || safe.shortDescription || '');
        safe.heroImageUrl = String(safe.heroImageUrl || '');
        safe.youtubeId = String(safe.youtubeId || '');
        safe.portions = String(safe.portions || '3-4 servings');
        safe.prepCookTime = Number.isFinite(Number(safe.prepCookTime)) ? Number(safe.prepCookTime) : 30;
        safe.fridgeKeepTime = String(safe.fridgeKeepTime || '2 days');
        safe.freezeKeepTime = String(safe.freezeKeepTime || '1 month');
        safe.isActive = safe.isActive !== false;

        const wrappers = Array.isArray(safe.components) ? safe.components : [];
        safe.components = wrappers.map((wrapper: any, wi: number) => {
            const w = wrapper && typeof wrapper === 'object' ? wrapper : {};
            const components = Array.isArray(w.component) ? w.component : [];
            return {
                prepShortDescription: String(w.prepShortDescription || ''),
                prepLongDescription: String(w.prepLongDescription || ''),
                variantTags: Array.isArray(w.variantTags) ? w.variantTags.filter(Boolean).map(String) : [],
                stronglyRecommended: Boolean(w.stronglyRecommended),
                choiceInstructions: String(w.choiceInstructions || ''),
                buttonText: String(w.buttonText || ''),
                component: components.map((comp: any, ci: number) => {
                    const c = comp && typeof comp === 'object' ? comp : {};
                    return {
                        componentTitle: String(c.componentTitle || `Component ${wi + 1}.${ci + 1}`),
                        componentInstructions: String(c.componentInstructions || ''),
                        includedInVariants: Array.isArray(c.includedInVariants) ? c.includedInVariants.filter(Boolean).map(String) : [],
                        requiredIngredients: (Array.isArray(c.requiredIngredients) ? c.requiredIngredients : [])
                            .map((ri: any) => ({
                                ingredientName: String(ri?.ingredientName || ''),
                                quantity: String(ri?.quantity || ''),
                                preparation: String(ri?.preparation || ''),
                                alternativeIngredients: Array.isArray(ri?.alternativeIngredients)
                                    ? ri.alternativeIngredients
                                        .map((ai: any) => ({
                                            ingredientName: String(ai?.ingredientName || ''),
                                            quantity: String(ai?.quantity || ''),
                                            preparation: String(ai?.preparation || ''),
                                            inheritQuantity: Boolean(ai?.inheritQuantity),
                                            inheritPreparation: Boolean(ai?.inheritPreparation),
                                        }))
                                        .filter((ai: any) => ai.ingredientName)
                                    : [],
                            }))
                            .filter((ri: any) => ri.ingredientName),
                        optionalIngredients: (Array.isArray(c.optionalIngredients) ? c.optionalIngredients : [])
                            .map((oi: any) => ({
                                ingredientName: String(oi?.ingredientName || ''),
                                quantity: String(oi?.quantity || ''),
                                preparation: String(oi?.preparation || ''),
                            }))
                            .filter((oi: any) => oi.ingredientName),
                        componentSteps: (Array.isArray(c.componentSteps) ? c.componentSteps : [])
                            .map((s: any) => ({ stepInstructions: String(s?.stepInstructions || ''), alwaysShow: s?.alwaysShow !== false }))
                            .filter((s: any) => s.stepInstructions),
                    };
                }),
            };
        }).filter((w: any) => w.component?.length > 0);

        if (safe.components.length === 0) {
            safe.components = [{
                prepShortDescription: '', prepLongDescription: '', variantTags: [],
                stronglyRecommended: false, choiceInstructions: '', buttonText: '',
                component: [{ componentTitle: 'Main Dish', componentInstructions: '', includedInVariants: [],
                    requiredIngredients: [], optionalIngredients: [], componentSteps: [] }],
            }];
        }
        return safe;
    }

    private async callAI(
        message: string,
    ): Promise<{ success: boolean; message: string; data?: any }> {
        try {
            const primaryUrl = this.extractPrimaryUrl(message);
            const isUrl = Boolean(primaryUrl);
            const isYoutube = isUrl && this.isYoutubeUrl(primaryUrl);
            const youtubeVideoId = isYoutube ? this.extractYoutubeVideoId(primaryUrl) : null;

            let recipeContent = '';

            if (isYoutube && youtubeVideoId) {
                const [transcript, webContent] = await Promise.allSettled([
                    this.fetchYoutubeTranscript(youtubeVideoId),
                    this.fetchRecipeContent(primaryUrl, 'gpt-4o-mini'),
                ]);

                const transcriptText = transcript.status === 'fulfilled' ? transcript.value : '';
                const webTextRaw = webContent.status === 'fulfilled' ? webContent.value : '';
                const webText = /SOURCE_INSUFFICIENT/i.test(webTextRaw) ? '' : webTextRaw;

                if (webText && transcriptText) {
                    recipeContent = `=== RECIPE FROM WEB SEARCH (source: ${primaryUrl}) ===\n${webText}\n\n=== YOUTUBE TRANSCRIPT (extra detail) ===\n${transcriptText.substring(0, 8000)}\n`;
                    this.logger.log(`[callAI] Web: ${webText.length} chars + transcript: ${transcriptText.length} chars`);
                } else if (webText) {
                    recipeContent = webText;
                    this.logger.log(`[callAI] Web search only: ${webText.length} chars`);
                } else if (transcriptText) {
                    recipeContent = `=== YOUTUBE TRANSCRIPT (video ID: ${youtubeVideoId}) ===\n${transcriptText}\n`;
                    this.logger.log(`[callAI] Transcript only: ${transcriptText.length} chars`);
                } else {
                    this.logger.warn(`[callAI] Source insufficient for youtube link ${primaryUrl}`);
                    return {
                        success: false,
                        message: 'Could not reliably extract recipe details from this YouTube link. Please try another link with clearer ingredients and steps.',
                    };
                }
            } else if (isUrl) {
                try {
                    recipeContent = await this.fetchRecipeContent(primaryUrl, 'gpt-4o-mini');
                } catch (miniErr: any) {
                    this.logger.warn(`[callAI] gpt-4o-mini web search failed: ${miniErr?.message}`);
                    recipeContent = await this.fetchRecipeContent(primaryUrl, 'gpt-4o');
                }
            } else {
                try {
                    recipeContent = await this.fetchRecipeContent(message, 'gpt-4o-mini');
                } catch {
                    recipeContent = String(message || '').trim();
                }
            }

            if (!recipeContent.trim() || /SOURCE_INSUFFICIENT/i.test(recipeContent)) {
                return { success: false, message: 'Could not extract recipe content. Please try a different link.' };
            }

            let recipe: any;
            try {
                recipe = await this.structureAsJson(recipeContent, 'gpt-4o-mini');
            } catch (miniErr: any) {
                this.logger.warn(`[callAI] stage2 gpt-4o-mini failed: ${miniErr?.message}`);
                recipe = await this.structureAsJson(recipeContent, 'gpt-4o');
            }

            if (youtubeVideoId && !recipe.youtubeId) {
                recipe.youtubeId = youtubeVideoId;
            } else if (isUrl && !recipe.youtubeId) {
                const ytMatch = primaryUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (ytMatch) recipe.youtubeId = ytMatch[1];
            }

            const normalized = this.normalizeRecipeShape(recipe);
            return { success: true, message: 'Recipe extracted successfully.', data: normalized };
        } catch (err: any) {
            if (err?.status === 429) {
                return { success: false, message: 'Rate limited. Please wait a minute and try again.' };
            }
            this.logger.error(`[callAI] Final error: ${err?.message}`, err?.stack);
            throw err;
        }
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
        await this.reconcileUserRecipeStatuses(userId);
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

    async createPendingRecipe(userId: string, sourceMessage: string) {
        const trimmed = String(sourceMessage || '').trim();
        const title = trimmed.length > 100 ? `${trimmed.substring(0, 97)}...` : (trimmed || 'Generating recipe...');
        return await this.userRecipeModel.create({
            userid: userId,
            status: 'pending',
            title,
            shortDescription: '',
            longDescription: '',
            heroImageUrl: '',
            youtubeId: '',
            portions: '',
            prepCookTime: 0,
            hackOrTipIds: [],
            frameworkCategories: [],
            useLeftoversIn: [],
            components: [],
            isActive: true,
            countries: [],
        });
    }

    async updatePendingRecipe(recipeId: string, userId: string, recipeData: any) {
        if (!Types.ObjectId.isValid(recipeId)) {
            return { success: false, message: 'Invalid recipe ID.' };
        }

        try {
            const sanitized = this.sanitizeRecipeData(recipeData);
            sanitized.status = 'accepted';
            sanitized.userid = userId;

            const updated = await this.userRecipeModel
                .findOneAndUpdate(
                    { _id: new Types.ObjectId(recipeId), ...this.buildUserMatch(userId) },
                    { $set: sanitized },
                    { new: true },
                )
                .exec();

            if (!updated) {
                return { success: false, message: 'Pending recipe not found.' };
            }

            return { success: true, message: 'Recipe updated successfully.', data: updated };
        } catch (error) {
            console.error('Error updating pending recipe:', error);
            return { success: false, message: 'An error occurred while updating the recipe.' };
        }
    }

    async setRecipeStatus(recipeId: string, userId: string, status: 'pending' | 'accepted' | 'rejected') {
        if (!Types.ObjectId.isValid(recipeId)) return null;
        return await this.userRecipeModel
            .findOneAndUpdate(
                { _id: new Types.ObjectId(recipeId), ...this.buildUserMatch(userId) },
                { $set: { status } },
                { new: true },
            )
            .exec();
    }

    private async reconcileUserRecipeStatuses(userId: string) {
        const userMatch = this.buildUserMatch(userId);

        // Auto-heal rows that have completed content but are still marked pending.
        await this.userRecipeModel.updateMany(
            {
                ...userMatch,
                status: 'pending',
                $or: [
                    { shortDescription: { $exists: true, $ne: '' } },
                    { 'components.0': { $exists: true } },
                    { prepCookTime: { $gt: 0 } },
                    { portions: { $exists: true, $ne: '' } },
                ],
            },
            { $set: { status: 'accepted' } },
        );

        // If an accepted recipe already exists for the same youtubeId, any pending
        // sibling entry is stale and should not keep loading forever.
        const acceptedWithYoutube = await this.userRecipeModel
            .find({ ...userMatch, status: 'accepted', youtubeId: { $exists: true, $ne: '' } })
            .select({ youtubeId: 1 })
            .lean()
            .exec();
        const acceptedYoutubeIds = Array.from(
            new Set(
                acceptedWithYoutube
                    .map((r: any) => String(r.youtubeId || '').trim())
                    .filter(Boolean),
            ),
        );

        if (acceptedYoutubeIds.length > 0) {
            await this.userRecipeModel.updateMany(
                {
                    ...userMatch,
                    status: 'pending',
                    youtubeId: { $in: acceptedYoutubeIds },
                },
                { $set: { status: 'rejected' } },
            );
        }
    }

    private sanitizeRecipeData(data: any): any {
        data.hackOrTipIds = [];
        data.frameworkCategories = [];
        data.useLeftoversIn = [];
        data.stickerId = undefined;
        data.sponsorId = undefined;

        if (Array.isArray(data.components)) {
            for (const wrapper of data.components) {
                if (!Array.isArray(wrapper.component)) continue;
                for (const comp of wrapper.component) {
                    // Keep only name-based ingredients
                    if (Array.isArray(comp.requiredIngredients)) {
                        for (const ri of comp.requiredIngredients) {
                            ri.recommendedIngredient = undefined;
                            if (Array.isArray(ri.alternativeIngredients)) {
                                for (const ai of ri.alternativeIngredients) {
                                    ai.ingredient = undefined;
                                }
                                ri.alternativeIngredients = ri.alternativeIngredients.filter(
                                    (ai: any) => ai.ingredientName,
                                );
                            }
                        }
                        comp.requiredIngredients = comp.requiredIngredients.filter(
                            (ri: any) => ri.ingredientName,
                        );
                    }
                    if (Array.isArray(comp.optionalIngredients)) {
                        for (const oi of comp.optionalIngredients) {
                            oi.ingredient = undefined;
                        }
                        comp.optionalIngredients = comp.optionalIngredients.filter(
                            (oi: any) => oi.ingredientName,
                        );
                    }
                    if (Array.isArray(comp.componentSteps)) {
                        for (const step of comp.componentSteps) {
                            step.relevantIngredients = [];
                            step.hackOrTipIds = [];
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
            sanitized.status = 'accepted';
            const data = await this.userRecipeModel.create(sanitized);
            return { success: true, message: 'Recipe created successfully.', data };
        } catch (error) {
            console.error('Error creating recipe:', error);
            return { success: false, message: 'An error occurred while creating the recipe.' };
        }
    }
}
