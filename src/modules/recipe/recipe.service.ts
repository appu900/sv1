import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { Recipe, RecipeDocument } from '../../database/schemas/recipe.schema';
import { FrameworkCategory, FrameworkCategoryDocument } from '../../database/schemas/framework-category.schema';
import { Ingredient, IngredientDocument } from '../../database/schemas/ingredient.schema';
import { DietCategory, DietCategoryDocument } from '../../database/schemas/diet.schema';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { RedisService } from '../../redis/redis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { normalizeCountry } from '../../utils/countries.util';

export interface RecipeSummary {
  _id: string;
  title: string;
  heroImageUrl?: string;
  order: number;
  frameworkCategoryIds: string[];
  variantTags: string[];
  sticker?: {
    id: string;
    imageUrl: string;
  };
  unsubstitutableIngredientIds: string[];
}

@Injectable()
export class RecipeService implements OnModuleInit {
  private readonly CACHE_TTL = 1200; // 20 minutes
  private readonly CACHE_KEY_ALL = 'recipes:all';
  private readonly CACHE_KEY_SINGLE = 'recipes:single';
  private readonly CACHE_KEY_CATEGORY = 'recipes:category';
  private readonly CACHE_KEY_SUMMARIES = 'recipes:summaries:v1';
  private readonly summaryRefreshes = new Map<
    string,
    Promise<RecipeSummary[]>
  >();

  constructor(
    @InjectModel(Recipe.name) private recipeModel: Model<RecipeDocument>,
    @InjectModel(FrameworkCategory.name) private frameworkCategoryModel: Model<FrameworkCategoryDocument>,
    @InjectModel(Ingredient.name) private ingredientModel: Model<IngredientDocument>,
    @InjectModel(DietCategory.name) private dietCategoryModel: Model<DietCategoryDocument>,
    private readonly redisService: RedisService,
    private readonly imageUploadService: ImageUploadService,
  ) {}

  async onModuleInit() {
    try {
      // Flush all recipe caches so any stale data is cleared on startup
      await this.redisService.delByPattern('recipes:*');
      await this.redisService.delByPattern('dietary:*');
      console.log('[RecipeService] All recipe/dietary caches flushed on startup');
    } catch (e) {
      console.warn('[RecipeService] Could not flush recipe caches on startup:', e?.message);
    }

    // One-time cleanup: remove empty-string ObjectId fields that would cause cast errors
    try {
      await this.recipeModel.updateMany(
        { $or: [{ stickerId: '' }, { sponsorId: '' }] },
        { $unset: { stickerId: 1, sponsorId: 1 } },
      );
    } catch (e) {
      console.warn('[RecipeService] Could not run ObjectId field cleanup:', e?.message);
    }
  }


  private processComponents(components: any[]): any[] {
    if (!Array.isArray(components) || components.length === 0) {
      throw new BadRequestException('At least one component wrapper is required');
    }

    return components.map((wrapper, wrapperIndex) => {
      // Support both `component` and `components` keys from the client
      const componentArray = Array.isArray(wrapper.component)
        ? wrapper.component
        : Array.isArray((wrapper as any).components)
        ? (wrapper as any).components
        : [];

      if (componentArray.length === 0) {
        throw new BadRequestException(
          `Component wrapper ${wrapperIndex} must have at least one component`
        );
      }

      return {
        prepShortDescription: wrapper.prepShortDescription,
        prepLongDescription: wrapper.prepLongDescription,
        variantTags: wrapper.variantTags || [],
        stronglyRecommended: wrapper.stronglyRecommended || false,
        choiceInstructions: wrapper.choiceInstructions,
        buttonText: wrapper.buttonText,
        component: componentArray.map((comp: any, compIndex: number) => {
          if (!comp.componentTitle || comp.componentTitle.trim() === '') {
            throw new BadRequestException(
              `Component title is required for wrapper ${wrapperIndex}, component ${compIndex}`
            );
          }

          return {
            componentTitle: comp.componentTitle,
            componentInstructions: comp.componentInstructions,
            includedInVariants: comp.includedInVariants || [],

            requiredIngredients: (comp.requiredIngredients || []).map(
              (reqIng: any, reqIndex: number) => {
                if (!reqIng.recommendedIngredient || !Types.ObjectId.isValid(reqIng.recommendedIngredient)) {
                  throw new BadRequestException(
                    `Invalid ingredient ID in wrapper ${wrapperIndex}, component ${compIndex}, required ingredient ${reqIndex}: "${reqIng.recommendedIngredient}"`
                  );
                }
                return {
                  recommendedIngredient: new Types.ObjectId(
                    reqIng.recommendedIngredient,
                  ),
                  quantity: reqIng.quantity,
                  preparation: reqIng.preparation,

                  alternativeIngredients: (
                    reqIng.alternativeIngredients || []
                  ).map((altIng: any, altIndex: number) => {
                    if (!altIng.ingredient || !Types.ObjectId.isValid(altIng.ingredient)) {
                      throw new BadRequestException(
                        `Invalid alternative ingredient ID in wrapper ${wrapperIndex}, component ${compIndex}, required ingredient ${reqIndex}, alternative ${altIndex}: "${altIng.ingredient}"`
                      );
                    }
                    return {
                      ingredient: new Types.ObjectId(altIng.ingredient),
                      inheritQuantity: altIng.inheritQuantity || false,
                      inheritPreparation: altIng.inheritPreparation || false,
                      quantity: altIng.quantity,
                      preparation: altIng.preparation,
                    };
                  }),
                };
              },
            ),

            optionalIngredients: (comp.optionalIngredients || []).map(
              (optIng: any, optIndex: number) => {
                if (!optIng.ingredient || !Types.ObjectId.isValid(optIng.ingredient)) {
                  throw new BadRequestException(
                    `Invalid optional ingredient ID in wrapper ${wrapperIndex}, component ${compIndex}, optional ingredient ${optIndex}: "${optIng.ingredient}"`
                  );
                }
                return {
                  ingredient: new Types.ObjectId(optIng.ingredient),
                  quantity: optIng.quantity,
                  preparation: optIng.preparation,
                };
              },
            ),

            componentSteps: (comp.componentSteps || []).map((step: any) => ({
              stepInstructions: step.stepInstructions,
              hackOrTipIds: (step.hackOrTipIds || [])
                .filter((id: string) => id && Types.ObjectId.isValid(id))
                .map((id: string) => new Types.ObjectId(id)),
              alwaysShow: step.alwaysShow || false,
              relevantIngredients: (step.relevantIngredients || [])
                .filter((id: string) => id && Types.ObjectId.isValid(id))
                .map((id: string) => new Types.ObjectId(id)),
            })),
          };
        }),
      };
    });
  }

  async create(
    createRecipeDto: CreateRecipeDto,
    heroImageFile?: Express.Multer.File,
  ): Promise<Recipe> {
    try {
      let heroImageUrl: string | undefined;
      if (heroImageFile) {
        heroImageUrl = await this.imageUploadService.uploadFile(
          heroImageFile,
          'recipes',
        );
      }

      const processedComponents = this.processComponents(
        createRecipeDto.components,
      );
      if (processedComponents?.length) {
        const firstWrapper = processedComponents[0] as any;
        const firstComp = Array.isArray(firstWrapper?.component)
          ? firstWrapper.component[0]
          : undefined;
        console.log('RecipeService.processedComponents count:', processedComponents.length);
        console.log('RecipeService.firstWrapper keys:', Object.keys(firstWrapper || {}));
        if (firstComp) {
          console.log('RecipeService.firstComponent keys:', Object.keys(firstComp));
        }
      }

      const validFrameworkCategories = createRecipeDto.frameworkCategories
        .filter(id => id && Types.ObjectId.isValid(id))
        .map(id => new Types.ObjectId(id));
      
      if (validFrameworkCategories.length === 0) {
        throw new BadRequestException('At least one valid framework category is required');
      }

      const validCuisines = (createRecipeDto.cuisines || [])
        .filter(id => id && Types.ObjectId.isValid(id))
        .map(id => new Types.ObjectId(id));

      const recipeData: any = {
        ...createRecipeDto,
        heroImageUrl: heroImageUrl || createRecipeDto.heroImageUrl,
        hackOrTipIds: (createRecipeDto.hackOrTipIds || [])
          .filter(id => id && Types.ObjectId.isValid(id))
          .map(id => new Types.ObjectId(id)),
        chefIds: (createRecipeDto.chefIds || [])
          .filter(id => id && Types.ObjectId.isValid(id))
          .map(id => new Types.ObjectId(id)),
        frameworkCategories: validFrameworkCategories,
        cuisines: validCuisines,
        useLeftoversIn: (createRecipeDto.useLeftoversIn || [])
          .filter(id => id && Types.ObjectId.isValid(id))
          .map(id => new Types.ObjectId(id)),
        stickerId: createRecipeDto.stickerId && Types.ObjectId.isValid(createRecipeDto.stickerId)
          ? new Types.ObjectId(createRecipeDto.stickerId)
          : undefined,
        sponsorId: createRecipeDto.sponsorId && Types.ObjectId.isValid(createRecipeDto.sponsorId)
          ? new Types.ObjectId(createRecipeDto.sponsorId)
          : undefined,
        components: processedComponents,
      };

      const recipe = new this.recipeModel(recipeData);
      const savedRecipe = await recipe.save();

      // Debug: confirm what was persisted
      try {
        const firstWrapper: any = (savedRecipe.components || [])[0];
        const firstComp: any = Array.isArray(firstWrapper?.component)
          ? firstWrapper.component[0]
          : undefined;
        console.log('SavedRecipe.components length:', savedRecipe.components?.length || 0);
        if (firstWrapper) {
          console.log('SavedRecipe.firstWrapper keys:', Object.keys(firstWrapper));
        }
        if (firstComp) {
          console.log('SavedRecipe.firstComponent keys:', Object.keys(firstComp));
          console.log('SavedRecipe.firstComponent requiredIngredients length:', firstComp.requiredIngredients?.length || 0);
          console.log('SavedRecipe.firstComponent optionalIngredients length:', firstComp.optionalIngredients?.length || 0);
          console.log('SavedRecipe.firstComponent componentSteps length:', firstComp.componentSteps?.length || 0);
        }
      } catch (e) {
        console.log('SavedRecipe debug logging failed:', e?.message);
      }

      await this.redisService.del(this.CACHE_KEY_ALL);
      await this.redisService.delByPattern(`${this.CACHE_KEY_ALL}:country:*`);
      await this.redisService.delByPattern(`${this.CACHE_KEY_CATEGORY}:*:country:*`);
      await this.invalidateRecipeSummaryCaches();
      // Also clear per-category caches for affected framework categories
      try {
        for (const catId of recipeData.frameworkCategories || []) {
          await this.redisService.del(
            `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
          );
        }
      } catch (e) {
        console.warn('Failed clearing category cache after create:', e?.message);
      }

      return savedRecipe;
    } catch (error) {
      throw new BadRequestException(
        `Failed to create recipe: ${error.message}`,
      );
    }
  }

  async findSummaries(country?: string): Promise<RecipeSummary[]> {
    const normalizedCountry = normalizeCountry(country);
    const cacheKey = normalizedCountry
      ? `${this.CACHE_KEY_SUMMARIES}:country:${normalizedCountry.toLowerCase()}`
      : this.CACHE_KEY_SUMMARIES;

    try {
      const cached =
        await this.redisService.get<RecipeSummary[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Redis is an optimization. Keep the Make page available without it.
    }

    const activeRefresh = this.summaryRefreshes.get(cacheKey);
    if (activeRefresh) {
      return activeRefresh;
    }

    const refresh = this.refreshRecipeSummaries(cacheKey, normalizedCountry);
    this.summaryRefreshes.set(cacheKey, refresh);
    try {
      return await refresh;
    } finally {
      if (this.summaryRefreshes.get(cacheKey) === refresh) {
        this.summaryRefreshes.delete(cacheKey);
      }
    }
  }

  private async refreshRecipeSummaries(
    cacheKey: string,
    country?: string,
  ): Promise<RecipeSummary[]> {
    const lockKey = `${cacheKey}:lock`;
    const lockToken = randomUUID();
    const lockTtlSeconds = 15;
    let hasLock = false;

    try {
      hasLock = await this.redisService.setIfAbsent(
        lockKey,
        lockToken,
        lockTtlSeconds,
      );
    } catch {
      return this.loadAndCacheRecipeSummaries(cacheKey, country);
    }

    if (!hasLock) {
      const deadline = Date.now() + 16_000;
      while (Date.now() < deadline) {
        await this.delay(250);
        try {
          const cached =
            await this.redisService.get<RecipeSummary[]>(cacheKey);
          if (cached) {
            return cached;
          }
          hasLock = await this.redisService.setIfAbsent(
            lockKey,
            lockToken,
            lockTtlSeconds,
          );
          if (hasLock) {
            break;
          }
        } catch {
          return this.loadAndCacheRecipeSummaries(cacheKey, country);
        }
      }
    }

    try {
      return await this.loadAndCacheRecipeSummaries(cacheKey, country);
    } finally {
      if (hasLock) {
        try {
          await this.redisService.releaseLock(lockKey, lockToken);
        } catch {
          // The lock expires automatically if Redis cannot release it.
        }
      }
    }
  }

  private async loadAndCacheRecipeSummaries(
    cacheKey: string,
    country?: string,
  ): Promise<RecipeSummary[]> {
    const matchQuery: Record<string, unknown> = { isActive: true };
    if (country) {
      matchQuery.countries = country;
    }

    try {
      const recipes = await this.recipeModel
        .find(matchQuery)
        .select(
          '_id title heroImageUrl order frameworkCategories ' +
            'stickerId components.variantTags ' +
            'components.component.requiredIngredients.recommendedIngredient ' +
            'components.component.requiredIngredients.alternativeIngredients.ingredient',
        )
        .populate('stickerId', 'imageUrl')
        .sort({ order: 1 })
        .lean()
        .exec();
      const summaries = recipes.map((recipe) =>
        this.mapRecipeSummary(recipe),
      );

      try {
        await this.redisService.set(cacheKey, summaries, this.CACHE_TTL);
      } catch {
        // A cache write must not hide a successful database response.
      }
      return summaries;
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch recipe summaries: ${error.message}`,
      );
    }
  }

  private mapRecipeSummary(recipe: any): RecipeSummary {
    const categoryIds: string[] = (recipe.frameworkCategories || [])
      .map((value: unknown) => this.summaryId(value))
      .filter((value: string) => Boolean(value));
    const variantTags = new Set<string>();
    const unsubstitutableIngredientIds = new Set<string>();

    for (const wrapper of recipe.components || []) {
      for (const tag of wrapper.variantTags || []) {
        if (typeof tag === 'string' && tag.trim()) {
          variantTags.add(tag.trim());
        }
      }
      for (const component of wrapper.component || []) {
        for (const required of component.requiredIngredients || []) {
          if ((required.alternativeIngredients || []).length === 0) {
            const ingredientId = this.summaryId(
              required.recommendedIngredient,
            );
            if (ingredientId) {
              unsubstitutableIngredientIds.add(ingredientId);
            }
          }
        }
      }
    }

    const stickerId = this.summaryId(recipe.stickerId);
    const stickerImage =
      recipe.stickerId &&
      typeof recipe.stickerId === 'object' &&
      typeof recipe.stickerId.imageUrl === 'string'
        ? recipe.stickerId.imageUrl
        : '';

    return {
      _id: this.summaryId(recipe._id),
      title: typeof recipe.title === 'string' ? recipe.title : '',
      ...(typeof recipe.heroImageUrl === 'string' && recipe.heroImageUrl
        ? { heroImageUrl: recipe.heroImageUrl }
        : {}),
      order: Number.isFinite(recipe.order) ? recipe.order : 0,
      frameworkCategoryIds: [...new Set(categoryIds)],
      variantTags: [...variantTags],
      ...(stickerId && stickerImage
        ? { sticker: { id: stickerId, imageUrl: stickerImage } }
        : {}),
      unsubstitutableIngredientIds: [...unsubstitutableIngredientIds],
    };
  }

  private summaryId(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value._id) return this.summaryId(value._id);
    if (value.$oid) return String(value.$oid);
    const result = String(value);
    return result === '[object Object]' ? '' : result;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async invalidateRecipeSummaryCaches(): Promise<void> {
    try {
      await this.redisService.delByPattern(`${this.CACHE_KEY_SUMMARIES}*`);
    } catch (error) {
      console.warn(
        'Failed clearing recipe summary caches:',
        error?.message,
      );
    }
  }

  async findAll(country?: string): Promise<Recipe[]> {
    // Normalize ISO code (e.g. 'IN') → full name (e.g. 'India') to match DB values.
    country = normalizeCountry(country);
    // Country-specific cache key so each country gets its own cached result
    const cacheKey = country
      ? `${this.CACHE_KEY_ALL}:country:${country.toLowerCase()}`
      : this.CACHE_KEY_ALL;

    try {
      const cached = await this.redisService.get<Recipe[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Error reading cached recipes, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    try {
      // Build the match query with optional country filter.
      // When a country is provided, only return recipes explicitly tagged
      // with that country. Recipes with no countries field or an empty array
      // are NOT shown to country-specific users.
      const matchQuery: any = { isActive: true };
      if (country) {
        matchQuery.countries = country;
      }

      const recipes = await this.recipeModel
        .find(matchQuery)
        .populate('hackOrTipIds', 'title type shortDescription')
        .populate('chefIds', 'name email role')
        .populate('stickerId', 'title imageUrl description')
        .populate('frameworkCategories', 'name imageUrl')
        .populate('cuisines', 'title imageUrl')
        .populate('sponsorId', 'title logo logoBlackAndWhite broughtToYouBy tagline')
        .populate('useLeftoversIn', 'title heroImageUrl')
        .populate({
          path: 'components.component.requiredIngredients.recommendedIngredient',
          model: 'Ingredient',
          select: 'name averageWeight',
        })
        .populate({
          path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
          model: 'Ingredient',
          select: 'name averageWeight',
        })
        .populate({
          path: 'components.component.optionalIngredients.ingredient',
          model: 'Ingredient',
          select: 'name averageWeight',
        })
        .populate({
          path: 'components.component.componentSteps.hackOrTipIds',
          model: 'HackOrTip',
          select: 'title type shortDescription',
        })
        .populate({
          path: 'components.component.componentSteps.relevantIngredients',
          model: 'Ingredient',
          select: 'name averageWeight',
        })
        .sort({ order: 1 })
        .lean()
        .exec();

      await this.redisService.set(cacheKey, recipes, this.CACHE_TTL);

      return recipes;
    } catch (error) {
      console.error('Error fetching recipes from database:', error);
      throw new BadRequestException(
        `Failed to fetch recipes: ${error.message}`,
      );
    }
  }

  
  async findOne(id: string): Promise<Recipe> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid recipe ID format');
    }

    const cacheKey = `${this.CACHE_KEY_SINGLE}:${id}`;
    try {
      const cached = await this.redisService.get<Recipe>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Error reading cached recipe, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const recipe = await this.recipeModel
      .findById(id)
      .populate('hackOrTipIds', 'title type shortDescription')
      .populate('chefIds', 'name email role')
      .populate('stickerId', 'title imageUrl description')
      .populate('frameworkCategories', 'name imageUrl')
        .populate('cuisines', 'title imageUrl')
      .populate('sponsorId', 'title logo logoBlackAndWhite broughtToYouBy tagline')
      .populate('useLeftoversIn', 'title heroImageUrl')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
        select: 'title type shortDescription',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .lean()
      .exec();

    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found`);
    }

    await this.redisService.set(cacheKey, recipe, this.CACHE_TTL);

    return recipe;
  }


  async findBySlug(slug: string): Promise<Recipe> {
    if (!slug || typeof slug !== 'string') {
      throw new BadRequestException('Slug is required');
    }

    const cacheKey = `recipes:slug:${slug}`;
    try {
      const cached = await this.redisService.get<Recipe>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Error reading cached recipe by slug, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    // Build a regex that matches titles whose slugified form equals the slug.
    // Convert slug back to a title-like pattern: "chicken-tikka" → "chicken tikka" (case-insensitive)
    // Each hyphen-separated token is escaped so regex-special characters in
    // recipe titles (parentheses, brackets, +, etc.) are treated as literals.
    const titlePattern = slug
      .split('-')
      .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s\\-]+');

    const recipe = await this.recipeModel
      .findOne({ isActive: true, title: { $regex: new RegExp(`^${titlePattern}$`, 'i') } })
      .populate('hackOrTipIds', 'title type shortDescription')
      .populate('chefIds', 'name email role')
      .populate('stickerId', 'title imageUrl description')
      .populate('frameworkCategories', 'name imageUrl')
        .populate('cuisines', 'title imageUrl')
      .populate('sponsorId', 'title logo logoBlackAndWhite broughtToYouBy tagline')
      .populate('useLeftoversIn', 'title heroImageUrl')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
        select: 'title type shortDescription',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .lean()
      .exec();

    if (!recipe) {
      throw new NotFoundException(`Recipe with slug "${slug}" not found`);
    }

    await this.redisService.set(cacheKey, recipe, this.CACHE_TTL);

    return recipe;
  }

  async findByFrameworkCategory(categoryId: string, country?: string): Promise<Recipe[]> {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException('Invalid category ID format');
    }
    country = normalizeCountry(country);

    const cacheKey = country
      ? `${this.CACHE_KEY_CATEGORY}:${categoryId}:country:${country.toLowerCase()}`
      : `${this.CACHE_KEY_CATEGORY}:${categoryId}`;
    try {
      const cached = await this.redisService.get<Recipe[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Error reading cached recipes by category, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const matchQuery: any = {
      frameworkCategories: new Types.ObjectId(categoryId),
      isActive: true,
    };
    if (country) {
      matchQuery.countries = country;
    }

    const recipes = await this.recipeModel
      .find(matchQuery)
      .populate('hackOrTipIds', 'title type shortDescription')
      .populate('chefIds', 'name email role')
      .populate('stickerId', 'title imageUrl description')
      .populate('frameworkCategories', 'name imageUrl')
        .populate('cuisines', 'title imageUrl')
      .populate('sponsorId', 'title logo logoBlackAndWhite broughtToYouBy tagline')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .sort({ order: 1 })
      .lean()
      .exec();

    await this.redisService.set(cacheKey, recipes, this.CACHE_TTL);

    return recipes;
  }

  async findByIngredient(ingredientId: string, country?: string): Promise<Recipe[]> {
    if (!Types.ObjectId.isValid(ingredientId)) {
      throw new BadRequestException('Invalid ingredient ID format');
    }
    country = normalizeCountry(country);

    const cacheKey = country
      ? `recipes:ingredient:${ingredientId}:country:${country.toLowerCase()}`
      : `recipes:ingredient:${ingredientId}`;
    try {
      const cached = await this.redisService.get<Recipe[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      console.error('Error reading cached recipes by ingredient, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const ingredientObjectId = new Types.ObjectId(ingredientId);

    // Build the match query: filter by ingredient presence plus optional country.
    const ingredientConditions = [
      { 'components.component.requiredIngredients.recommendedIngredient': ingredientObjectId },
      { 'components.component.requiredIngredients.alternativeIngredients.ingredient': ingredientObjectId },
      { 'components.component.optionalIngredients.ingredient': ingredientObjectId },
    ];

    const matchQuery: any = { isActive: true, $or: ingredientConditions };
    if (country) {
      matchQuery.$and = [
        { $or: ingredientConditions },
        { countries: country },
      ];
      delete matchQuery.$or; 
    }


    const recipes = await this.recipeModel
      .find(matchQuery)
      .populate('hackOrTipIds', 'title type shortDescription')
      .populate('chefIds', 'name email role')
      .populate('stickerId', 'title imageUrl description')
      .populate('frameworkCategories', 'name imageUrl')
        .populate('cuisines', 'title imageUrl')
      .populate('sponsorId', 'title logo logoBlackAndWhite broughtToYouBy tagline')
      .populate('useLeftoversIn', 'title heroImageUrl')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
        select: 'title type shortDescription',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
        select: 'name averageWeight',
      })
      .sort({ order: 1 })
      .lean()
      .exec();

    await this.redisService.set(cacheKey, recipes, this.CACHE_TTL);

    return recipes;
  }


  async update(
    id: string,
    updateRecipeDto: UpdateRecipeDto,
    heroImageFile?: Express.Multer.File,
  ): Promise<Recipe> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid recipe ID format');
    }

    const existingRecipe = await this.recipeModel.findById(id);
    if (!existingRecipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found`);
    }

    try {
      let heroImageUrl = updateRecipeDto.heroImageUrl;
      if (heroImageFile) {
        heroImageUrl = await this.imageUploadService.uploadFile(
          heroImageFile,
          'recipes',
        );

        if (existingRecipe.heroImageUrl) {
          await this.imageUploadService.deleteFile(
            existingRecipe.heroImageUrl,
          );
        }
      }

      const processedComponents = updateRecipeDto.components
        ? this.processComponents(updateRecipeDto.components)
        : undefined;

      const updateData: any = {
        ...updateRecipeDto,
      };

      // Always remove these from the spread — they are handled explicitly below
      // to avoid saving empty strings as ObjectId fields (which causes CastErrors on populate).
      delete updateData.stickerId;
      delete updateData.sponsorId;

      if (heroImageUrl) {
        updateData.heroImageUrl = heroImageUrl;
      }

      if (updateRecipeDto.hackOrTipIds) {
        updateData.hackOrTipIds = updateRecipeDto.hackOrTipIds
          .filter(id => id && Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      if (updateRecipeDto.chefIds) {
        updateData.chefIds = updateRecipeDto.chefIds
          .filter(id => id && Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      if (updateRecipeDto.frameworkCategories) {
        const validCategories = updateRecipeDto.frameworkCategories
          .filter(id => id && Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
        
        if (validCategories.length === 0) {
          throw new BadRequestException('At least one valid framework category is required');
        }
        
        updateData.frameworkCategories = validCategories;
      }

      if (updateRecipeDto.cuisines !== undefined) {
        updateData.cuisines = updateRecipeDto.cuisines
          .filter(id => id && Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      if (updateRecipeDto.useLeftoversIn) {
        updateData.useLeftoversIn = updateRecipeDto.useLeftoversIn
          .filter(id => id && Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      const unsetFields: Record<string, 1> = {};

      if ('stickerId' in updateRecipeDto) {
        if (updateRecipeDto.stickerId && Types.ObjectId.isValid(updateRecipeDto.stickerId)) {
          updateData.stickerId = new Types.ObjectId(updateRecipeDto.stickerId);
        } else {
          // Empty string or null means "clear the sticker"
          unsetFields.stickerId = 1;
        }
      }

      if ('sponsorId' in updateRecipeDto) {
        if (updateRecipeDto.sponsorId && Types.ObjectId.isValid(updateRecipeDto.sponsorId)) {
          updateData.sponsorId = new Types.ObjectId(updateRecipeDto.sponsorId);
        } else {
          unsetFields.sponsorId = 1;
        }
      }

      if (processedComponents) {
        updateData.components = processedComponents;
      }

      const mongoUpdate = Object.keys(unsetFields).length > 0
        ? { $set: updateData, $unset: unsetFields }
        : updateData;

      const updatedRecipe = await this.recipeModel
        .findByIdAndUpdate(id, mongoUpdate, { new: true })
        .exec();

      if (!updatedRecipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found after update`);
      }

      await this.redisService.del(this.CACHE_KEY_ALL);
      await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);
      await this.redisService.delByPattern(`${this.CACHE_KEY_ALL}:country:*`);
      await this.redisService.delByPattern(`${this.CACHE_KEY_CATEGORY}:*:country:*`);
      await this.invalidateRecipeSummaryCaches();

      try {
        const prevCats = existingRecipe.frameworkCategories || [];
        for (const catId of prevCats) {
          await this.redisService.del(
            `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
          );
        }
        const newCats = updatedRecipe.frameworkCategories || [];
        for (const catId of newCats) {
          await this.redisService.del(
            `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
          );
        }
      } catch (e) {
        console.warn('Failed clearing category cache after update:', e?.message);
      }

      return updatedRecipe;
    } catch (error) {
      throw new BadRequestException(
        `Failed to update recipe: ${error.message}`,
      );
    }
  }

  
  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid recipe ID format');
    }

    const recipe = await this.recipeModel.findById(id);
    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found`);
    }

    if (recipe.heroImageUrl) {
      await this.imageUploadService.deleteFile(recipe.heroImageUrl);
    }

    await this.recipeModel.findByIdAndDelete(id).exec();

    await this.redisService.del(this.CACHE_KEY_ALL);
    await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);
    await this.redisService.delByPattern(`${this.CACHE_KEY_ALL}:country:*`);
    await this.redisService.delByPattern(`${this.CACHE_KEY_CATEGORY}:*:country:*`);
    await this.invalidateRecipeSummaryCaches();

    if (recipe.frameworkCategories) {
      for (const catId of recipe.frameworkCategories) {
        await this.redisService.del(
          `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
        );
      }
    }
  }

 
  private static readonly DIET_NAME_PATTERNS: Record<string, string[]> = {
    vegan:       ['vegan'],
    vegetarian:  ['vegetarian', 'vegetarian (lacto-ovo)'],
    dairyFree:   ['dairy-free', 'dairy free', 'lactose-free'],
    nutFree:     ['nut-free', 'nut free', 'peanut-free'],
    glutenFree:  ['gluten-free', 'gluten free'],
    diabetes:    ['diabetic-friendly', 'low-sugar', 'diabetes'],
  };

  async getDietaryRecommendations(params: {
    vegType?: string;
    dairyFree?: boolean;
    nutFree?: boolean;
    glutenFree?: boolean;
    hasDiabetes?: boolean;
    country?: string;
  }): Promise<any[]> {
    const { vegType, dairyFree, nutFree, glutenFree, hasDiabetes, country } = params;
    const patternMap = RecipeService.DIET_NAME_PATTERNS;

    const activeKeys: string[] = [];
    if (vegType === 'VEGAN')           activeKeys.push('vegan');
    else if (vegType === 'VEGETARIAN') activeKeys.push('vegetarian');
    if (dairyFree)   activeKeys.push('dairyFree');
    if (nutFree)     activeKeys.push('nutFree');
    if (glutenFree)  activeKeys.push('glutenFree');
    if (hasDiabetes) activeKeys.push('diabetes');

    if (activeKeys.length === 0) return [];

    const resultCacheKey = `dietary:recommendations:${activeKeys.sort().join('+')}`
      + (country ? `:country:${country.toLowerCase()}` : '');

    // Return cached result if available
    try {
      const cached = await this.redisService.get<any[]>(resultCacheKey);
      if (cached) return cached;
    } catch (_) { /* ignore redis errors */ }

    // ── 2. Resolve DietCategory ObjectIds ───────────────────────────────────
    const namePatterns = activeKeys.flatMap(k => patternMap[k] ?? []);
    const dietCategories = await this.dietCategoryModel
      .find({ name: { $in: namePatterns.map(p => new RegExp(`^${p}$`, 'i')) } })
      .select('_id')
      .lean()
      .exec();

    if (dietCategories.length === 0) {
      return [];
    }

    const dietIds = new Set(dietCategories.map((d: any) => d._id.toString()));

    const ingCacheKey = `dietary:suitable-ingredients:${[...dietIds].sort().join('+')}`;
    let suitableIngredientIds: Set<string>;

    try {
      const cached = await this.redisService.get<string[]>(ingCacheKey);
      if (cached) {
        suitableIngredientIds = new Set(cached);
      } else {
        throw new Error('miss');
      }
    } catch (_) {
      const allIngredients = await this.ingredientModel
        .find({})
        .select('_id suitableDiets')
        .lean()
        .exec();

      suitableIngredientIds = new Set(
        allIngredients
          .filter((ing: any) => {
            const suited: string[] = (ing.suitableDiets ?? []).map((id: any) => id.toString());
            if (suited.length === 0) return true; 
            return [...dietIds].every(dId => suited.includes(dId));
          })
          .map((ing: any) => ing._id.toString()),
      );

      await this.redisService.set(ingCacheKey, [...suitableIngredientIds], this.CACHE_TTL).catch(() => {});
    }

    const matchQuery: any = { isActive: true };
    if (country) matchQuery.countries = normalizeCountry(country);

    const recipes = await this.recipeModel
      .find(matchQuery)
      .select(
        '_id title heroImageUrl order countries frameworkCategories stickerId ' +
        'components.component.requiredIngredients.recommendedIngredient',
      )
      .lean()
      .exec();

    const matching = recipes.filter((recipe: any) => {
      const requiredIds: string[] = [];
      for (const wrapper of (recipe.components ?? [])) {
        for (const comp of (wrapper.component ?? [])) {
          for (const ri of (comp.requiredIngredients ?? [])) {
            const id = ri.recommendedIngredient?.toString();
            if (id) requiredIds.push(id);
          }
        }
      }
      if (requiredIds.length === 0) return false; // skip skeleton/empty recipes
      return requiredIds.every(id => suitableIngredientIds.has(id));
    });

    let result = matching;
    if (result.length === 0 && country) {
      const allCountryRecipes = await this.recipeModel
        .find({ isActive: true })
        .select(
          '_id title heroImageUrl order countries frameworkCategories stickerId ' +
          'components.component.requiredIngredients.recommendedIngredient',
        )
        .lean()
        .exec();

      result = allCountryRecipes.filter((recipe: any) => {
        const requiredIds: string[] = [];
        for (const wrapper of (recipe.components ?? [])) {
          for (const comp of (wrapper.component ?? [])) {
            for (const ri of (comp.requiredIngredients ?? [])) {
              const id = ri.recommendedIngredient?.toString();
              if (id) requiredIds.push(id);
            }
          }
        }
        if (requiredIds.length === 0) return false;
        return requiredIds.every(id => suitableIngredientIds.has(id));
      });
    }

    const lean = result.map(({ components: _c, ...rest }: any) => rest);

    await this.redisService.set(resultCacheKey, lean, this.CACHE_TTL).catch(() => {});

    return lean;
  }
}