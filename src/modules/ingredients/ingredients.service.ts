import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IngredientsCategory,
  IngredientsCategoryDocument,
} from 'src/database/schemas/ingredinats.Category.schema';
import {
  Ingredient,
  IngredientDocument,
  Month,
} from 'src/database/schemas/ingredient.schema';
import { RedisService } from 'src/redis/redis.service';
import { CreateCatgoryDto } from './dto/ingrediants.category.dto';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { normalizeCountry } from '../../utils/countries.util';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { SqsService } from 'src/sqs/sqs.service';
import { CacheInvalidationEvent } from 'src/contracts/cache-invalidation.event';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DataVersionService } from '../data-version/data-version.service';
import { SummaryHeroImage } from '../recipe/recipe.service';

const VALID_MONTHS = new Set<string>(Object.values(Month));

function sanitizeSeasonByCountry(value: Record<string, Month[]> | undefined) {
  const result: Record<string, Month[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  for (const [country, months] of Object.entries(value)) {
    const normalizedCountry = country.trim();
    if (!normalizedCountry || !Array.isArray(months)) continue;

    const uniqueMonths = Array.from(
      new Set(
        months
          .map((month) => String(month).trim())
          .filter((month) => VALID_MONTHS.has(month)),
      ),
    ) as Month[];

    result[normalizedCountry] = uniqueMonths;
  }

  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


export interface IngredientSummary {
  _id: string;
  name: string;
  heroImageUrl?: string;
  heroImage?: SummaryHeroImage;
  theme?: string;
  inSeason: Month[];
  seasonByCountry: Record<string, Month[]>;
  order: number;
}
@Injectable()
export class IngredientsService implements OnModuleInit {
  static readonly CACHE_KEY_SUMMARIES = 'Ingredients:summaries:v1';
  private readonly logger = new Logger(IngredientsService.name);
  constructor(
    @InjectModel(IngredientsCategory.name)
    private readonly ingredinatsCategory: Model<IngredientsCategoryDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    private readonly redisService: RedisService,
    private readonly imageuploadService: ImageUploadService,
    private readonly sqsService:SqsService,
    @Optional() private readonly dataVersion?: DataVersionService,
  ) {}

  async onModuleInit() {

    try {
      await this.redisService.delByPattern('Ingredients:all*');
      await this.redisService.delByPattern(
        `${IngredientsService.CACHE_KEY_SUMMARIES}*`,
      );
      console.log('[IngredientsService] All ingredient caches flushed on startup');
    } catch (e) {
      console.warn('[IngredientsService] Could not flush ingredient caches on startup:', getErrorMessage(e));
    }
  }

  // Category Management
  async create(dto: CreateCatgoryDto, files: { image: Express.Multer.File[] }) {
    const existing = await this.ingredinatsCategory.findOne({ name: dto.name });
    console.log(existing);
    if (existing) throw new ConflictException('this categiry already exists');

    const categoryData: any = {
      name: dto.name,
    };

    if (files?.image?.[0]) {
      const imageUrl = await this.imageuploadService.uploadFile(
        files.image[0],
        'saveful/ingredinats-category',
      );
      categoryData.imageUrl = imageUrl;
    }

    const cachedKey = `Ingrediants:Category:all`;
    const result = await this.ingredinatsCategory.create(categoryData);
    await this.redisService.del(cachedKey);
    return result;
  }

  async getAllCategories() {
    const cachedKey = `Ingrediants:Category:all`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return JSON.parse(cachedData);
    const result = await this.ingredinatsCategory.find();
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }

  async updateCategory(
    id: string,
    dto: CreateCatgoryDto,
    files?: { image?: Express.Multer.File[] },
  ) {
    const category = await this.ingredinatsCategory.findById(id);
    if (!category) throw new NotFoundException('Category not found');

    const updateData: any = {
      name: dto.name,
    };

    // Only update image if a new one is provided
    if (files?.image?.[0]) {
      const imageUrl = await this.imageuploadService.uploadFile(
        files.image[0],
        'saveful/ingredinats-category',
      );
      updateData.imageUrl = imageUrl;
    }

    const result = await this.ingredinatsCategory.findByIdAndUpdate(
      id,
      updateData,
      { new: true },
    );

    const cachedKey = `Ingrediants:Category:all`;
    await this.redisService.del(cachedKey);
    return result;
  }

  async deleteCategory(id: string) {
    const category = await this.ingredinatsCategory.findById(id);
    if (!category) throw new NotFoundException('Category not found');

    // Check if any ingredients use this category
    const ingredientsUsingCategory = await this.ingredientModel.countDocuments(
      { categoryId: new Types.ObjectId(id) },
    );

    if (ingredientsUsingCategory > 0) {
      throw new ConflictException(
        `Cannot delete category. ${ingredientsUsingCategory} ingredient(s) are using this category.`,
      );
    }

    await this.ingredinatsCategory.findByIdAndDelete(id);

    const cachedKey = `Ingrediants:Category:all`;
    await this.redisService.del(cachedKey);
    return { message: 'Category deleted successfully' };
  }

  async createIngredient(
    dto: CreateIngredientDto,
    files?: { heroImage?: Express.Multer.File[] },
  ) {
    const ingredientData: any = {
      name: dto.name,
      averageWeight: dto.averageWeight,
      categoryId: new Types.ObjectId(dto.categoryId),
      hasPage: dto.hasPage || false,
    };

    if (dto.suitableDiets && dto.suitableDiets.length > 0) {
      ingredientData.suitableDiets = dto.suitableDiets
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    }

    if (dto.hasPage) {
      if (files?.heroImage?.[0]) {
        const heroImage = await this.imageuploadService.uploadImageWithVariants(
          files.heroImage[0],
          'saveful/ingredients/hero',
        );
        // `heroImageUrl` stays populated for clients that predate `heroImage`.
        ingredientData.heroImageUrl = heroImage.base;
        ingredientData.heroImage = heroImage;
      }

      if (dto.theme) ingredientData.theme = dto.theme;
      if (dto.description) ingredientData.description = dto.description;
      if (dto.nutrition) ingredientData.nutrition = dto.nutrition;

      if (dto.parentIngredients && dto.parentIngredients.length > 0) {
        ingredientData.parentIngredients = dto.parentIngredients
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      if (dto.foodFactId && Types.ObjectId.isValid(dto.foodFactId)) {
        ingredientData.foodFactId = new Types.ObjectId(dto.foodFactId);
      }

      if (dto.relatedHacks && dto.relatedHacks.length > 0) {
        ingredientData.relatedHacks = dto.relatedHacks
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id));
      }

      if (dto.inSeason && dto.inSeason.length > 0) {
        ingredientData.inSeason = dto.inSeason;
      }

      if (dto.seasonByCountry !== undefined) {
        ingredientData.seasonByCountry = sanitizeSeasonByCountry(dto.seasonByCountry);
      }

      if (dto.stickerId && Types.ObjectId.isValid(dto.stickerId)) {
        ingredientData.stickerId = new Types.ObjectId(dto.stickerId);
      }

      if (dto.isPantryItem !== undefined) {
        ingredientData.isPantryItem = dto.isPantryItem;
      }
    }

    if (dto.order !== undefined) {
      ingredientData.order = dto.order;
    }

    if (dto.countries !== undefined) {
      ingredientData.countries = dto.countries;
    }

    const ingredient = await this.ingredientModel.create(ingredientData);
    
    const ingredients = await this.ingredientModel
      .find()
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
      .populate('relatedHacks', 'title type')
      .populate('stickerId', 'title imageUrl')
      .sort({ order: 1, name: 1 })
      .lean();

    const { oldVersion, newVersion } = await this.redisService.setVersioned(
      'Ingredients:all',
      ingredients,
      60 * 20,
    );
    
    if (oldVersion > 0) {
      await this.sqsService.publishCacheInvalidation({
        eventType: 'CACHE_INVALIDATION',
        baseKey: 'Ingredients:all',
        invalidateVersions: [oldVersion],
        timestamp: Date.now(),
      });
      this.logger.log(
        `Cache invalidation pushed with version ${newVersion} for key Ingredients:all`,
      );
    }

    // Bust per-country caches so filtered results reflect the new data
    await this.invalidateIngredientListCaches();

    return ingredient;
  }

  async getIngredientSummaries(country?: string): Promise<IngredientSummary[]> {
    const normalizedCountry = normalizeCountry(country);
    const cacheKey = normalizedCountry
      ? `${IngredientsService.CACHE_KEY_SUMMARIES}:country:${normalizedCountry.toLowerCase()}`
      : IngredientsService.CACHE_KEY_SUMMARIES;

    try {
      const cached = await this.redisService.get<IngredientSummary[]>(cacheKey);
      if (cached) return cached;
    } catch (error) {
      this.logger.warn(
        `Ingredient summary cache read failed: ${getErrorMessage(error)}`,
      );
    }

    const matchQuery: Record<string, unknown> = { hasPage: true };
    if (normalizedCountry) {
      matchQuery.countries = normalizedCountry;
    }

    const rows = await this.ingredientModel
      .find(matchQuery)
      .select(
        '_id name heroImageUrl heroImage theme inSeason seasonByCountry order',
      )
      .sort({ order: 1, name: 1 })
      .lean();

    const summaries = rows.map((row) =>
      this.mapIngredientSummary(row, normalizedCountry),
    );

    try {
      await this.redisService.set(cacheKey, summaries, 60 * 20);
    } catch (error) {
      // A cache write must not hide a successful database response.
      this.logger.warn(
        `Ingredient summary cache write failed: ${getErrorMessage(error)}`,
      );
    }

    return summaries;
  }

  private mapIngredientSummary(
    row: any,
    country?: string,
  ): IngredientSummary {
    const seasonByCountry: Record<string, Month[]> = {};
    const source = row.seasonByCountry;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      if (country) {
 
        for (const [key, months] of Object.entries(source)) {
          if (key.trim().toLowerCase() === country.trim().toLowerCase()) {
            seasonByCountry[key] = months as Month[];
          }
        }
      } else {
        Object.assign(seasonByCountry, source);
      }
    }

    return {
      _id: String(row._id),
      name: typeof row.name === 'string' ? row.name : '',
      ...(typeof row.heroImageUrl === 'string' && row.heroImageUrl
        ? { heroImageUrl: row.heroImageUrl }
        : {}),
      ...(row.heroImage?.base
        ? {
            heroImage: {
              base: String(row.heroImage.base),
              variants:
                row.heroImage.variants &&
                typeof row.heroImage.variants === 'object'
                  ? { ...row.heroImage.variants }
                  : {},
              width: Number.isFinite(row.heroImage.width)
                ? row.heroImage.width
                : 0,
              height: Number.isFinite(row.heroImage.height)
                ? row.heroImage.height
                : 0,
              thumbhash:
                typeof row.heroImage.thumbhash === 'string'
                  ? row.heroImage.thumbhash
                  : '',
            },
          }
        : {}),
      ...(row.theme ? { theme: String(row.theme) } : {}),
      inSeason: Array.isArray(row.inSeason) ? row.inSeason : [],
      seasonByCountry,
      order: Number.isFinite(row.order) ? row.order : 0,
    };
  }

  async getAllIngredients(country?: string) {
    country = normalizeCountry(country);
    const baseKey = country
      ? `Ingredients:all:country:${country.toLowerCase()}`
      : 'Ingredients:all';

    if (country) {
      const cachedData = await this.redisService.get(baseKey);
      if (cachedData) {
        this.logger.log(`Cache hit for ${baseKey}`);
        return cachedData;
      }
      this.logger.warn(`Cache miss for ${baseKey}`);

      // Return only ingredients explicitly tagged with this country.
      const matchQuery: any = {
        countries: country,
      };

      const ingredients = await this.ingredientModel
        .find(matchQuery)
        .populate('categoryId', 'name imageUrl')
        .populate('suitableDiets', 'name')
        .populate('parentIngredients', 'name')
        .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
        .populate('relatedHacks', 'title type')
        .populate('stickerId', 'title imageUrl')
        .sort({ order: 1, name: 1 })
        .lean();

      await this.redisService.set(baseKey, ingredients, 60 * 20);
      return ingredients;
    }

    // No country filter — use existing versioned cache strategy
    const cachedIngrediants = await this.redisService.getVersioned(baseKey);

    if (cachedIngrediants) {
      console.log('cached hit for ingredinats:all');
      this.logger.log('Cache hit for Ingredients:all');
      return cachedIngrediants;
    }

    this.logger.warn('Cache miss for Ingredients:all');

    const ingredients = await this.ingredientModel
      .find()
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
      .populate('relatedHacks', 'title type')
      .populate('stickerId', 'title imageUrl')
      .sort({ order: 1, name: 1 })
      .lean();

    await this.redisService.setVersioned(baseKey, ingredients, 60 * 20);
    return ingredients;
  }

  async getIngredientById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid ingredient ID');
    }

    const ingredient = await this.ingredientModel
      .findById(id)
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name averageWeight')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo logoBlackAndWhite broughtToYouBy tagline' } })
      .populate('relatedHacks', 'title type shortDescription')
      .populate('stickerId', 'title imageUrl description')
      .lean();

    if (!ingredient) {
      throw new NotFoundException('Ingredient not found');
    }

    return ingredient;
  }

  async getIngredientsByIds(ids: string[]) {
    const validIds = ids
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id));
    if (validIds.length === 0) return [];

    // Check Redis cache for the batch (sorted IDs for stable key)
    const sortedIdStrs = validIds.map(id => id.toString()).sort();
    const batchCacheKey = `ingredients:batch:${sortedIdStrs.join(',')}`;
    try {
      const cached = await this.redisService.get(batchCacheKey);
      if (cached) return cached;
    } catch (_) { /* ignore */ }

    // Only select fields actually consumed by the frontend adapter
    const ingredients = await this.ingredientModel
      .find({ _id: { $in: validIds } })
      .select('name averageWeight categoryId')
      .populate('categoryId', 'name')
      .lean();

    await this.redisService.set(batchCacheKey, ingredients, 60 * 20).catch(() => {});

    return ingredients;
  }

  async updateIngredient(
    id: string,
    dto: UpdateIngredientDto,
    files?: { heroImage?: Express.Multer.File[] },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid ingredient ID');
    }

    const ingredient = await this.ingredientModel.findById(id);
    if (!ingredient) {
      throw new NotFoundException('Ingredient not found');
    }

    const updateData: any = {};

    // Update basic fields
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.averageWeight !== undefined)
      updateData.averageWeight = dto.averageWeight;
    if (dto.hasPage !== undefined) updateData.hasPage = dto.hasPage;

    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) {
      updateData.categoryId = new Types.ObjectId(dto.categoryId);
    }

    if (dto.suitableDiets !== undefined) {
      updateData.suitableDiets = dto.suitableDiets
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    }

    // Update hasPage related fields
    if (files?.heroImage?.[0]) {
      const heroImage = await this.imageuploadService.uploadImageWithVariants(
        files.heroImage[0],
        'saveful/ingredients/hero',
      );
      updateData.heroImageUrl = heroImage.base;
      updateData.heroImage = heroImage;
    }

    if (dto.theme !== undefined) updateData.theme = dto.theme;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.nutrition !== undefined) updateData.nutrition = dto.nutrition;

    if (dto.parentIngredients !== undefined) {
      updateData.parentIngredients = dto.parentIngredients
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    }

    if (dto.foodFactId !== undefined) {
      if (dto.foodFactId && Types.ObjectId.isValid(dto.foodFactId)) {
        updateData.foodFactId = new Types.ObjectId(dto.foodFactId);
      } else if (!dto.foodFactId) {
        updateData.foodFactId = null;
      }
    }

    if (dto.relatedHacks !== undefined) {
      updateData.relatedHacks = dto.relatedHacks
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    }

    if (dto.inSeason !== undefined) {
      updateData.inSeason = dto.inSeason;
    }

    if (dto.seasonByCountry !== undefined) {
      updateData.seasonByCountry = sanitizeSeasonByCountry(dto.seasonByCountry);
    }

    if (dto.stickerId !== undefined) {
      if (dto.stickerId && Types.ObjectId.isValid(dto.stickerId)) {
        updateData.stickerId = new Types.ObjectId(dto.stickerId);
      } else if (!dto.stickerId) {
        updateData.stickerId = null;
      }
    }

    if (dto.isPantryItem !== undefined) {
      updateData.isPantryItem = dto.isPantryItem;
    }

    if (dto.order !== undefined) {
      updateData.order = dto.order;
    }

    if (dto.countries !== undefined) {
      updateData.countries = dto.countries;
    }

    const updatedIngredient = await this.ingredientModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
      .populate('relatedHacks', 'title type')
      .populate('stickerId', 'title imageUrl');

    // Invalidate cache with versioned strategy
    const ingredients = await this.ingredientModel
      .find()
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
      .populate('relatedHacks', 'title type')
      .populate('stickerId', 'title imageUrl')
      .sort({ order: 1, name: 1 })
      .lean();

    // New caching strategy
    const { oldVersion, newVersion } = await this.redisService.setVersioned(
      'Ingredients:all',
      ingredients,
      60 * 20,
    );
    
    if (oldVersion > 0) {
      await this.sqsService.publishCacheInvalidation({
        eventType: 'CACHE_INVALIDATION',
        baseKey: 'Ingredients:all',
        invalidateVersions: [oldVersion],
        timestamp: Date.now(),
      });
      this.logger.log(
        `Cache invalidation pushed with version ${newVersion} for key Ingredients:all`,
      );
    }

    await this.invalidateIngredientListCaches();

    return updatedIngredient;
  }

  async deleteIngredient(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid ingredient ID');
    }

    const deletedIngredient = await this.ingredientModel.findByIdAndDelete(id);
    
    if (!deletedIngredient) {
      throw new NotFoundException('Ingredient not found');
    }

    if (deletedIngredient.heroImageUrl) {
      try {
        await this.imageuploadService.deleteFile(deletedIngredient.heroImageUrl);
      } catch (error) {
        this.logger.warn(`Failed to delete image for ingredient ${id}: ${getErrorMessage(error)}`);
      }
    }

    const ingredients = await this.ingredientModel
      .find()
      .populate('categoryId', 'name imageUrl')
      .populate('suitableDiets', 'name')
      .populate('parentIngredients', 'name')
      .populate({ path: 'foodFactId', populate: { path: 'sponsor', select: 'title logo' } })
      .populate('relatedHacks', 'title type')
      .populate('stickerId', 'title imageUrl')
      .sort({ order: 1, name: 1 })
      .lean();

    const { oldVersion, newVersion } = await this.redisService.setVersioned(
      'Ingredients:all',
      ingredients,
      60 * 20,
    );
    
    if (oldVersion > 0) {
      await this.sqsService.publishCacheInvalidation({
        eventType: 'CACHE_INVALIDATION',
        baseKey: 'Ingredients:all',
        invalidateVersions: [oldVersion],
        timestamp: Date.now(),
      });
      this.logger.log(
        `Cache invalidation pushed with version ${newVersion} for key Ingredients:all after deleting ingredient ${id}`,
      );
    }

    await this.invalidateIngredientListCaches();

    return { message: 'Ingredient deleted successfully' };
  }

  private async invalidateIngredientListCaches() {
    await this.redisService.delByPattern('Ingredients:all:country:*');
    await this.redisService.delByPattern(
      `${IngredientsService.CACHE_KEY_SUMMARIES}*`,
    );
    
    await this.dataVersion?.bump('ingredients');
  }

  private async clearIngredientCache() {
    const keys = ['Ingredients:all'];
    await Promise.all(keys.map((key) => this.redisService.del(key)));
  }
}
