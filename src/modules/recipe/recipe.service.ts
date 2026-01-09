import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Recipe, RecipeDocument } from '../../database/schemas/recipe.schema';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { RedisService } from '../../redis/redis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';

@Injectable()
export class RecipeService {
  private readonly CACHE_TTL = 1200; // 20 minutes
  private readonly CACHE_KEY_ALL = 'recipes:all';
  private readonly CACHE_KEY_SINGLE = 'recipes:single';
  private readonly CACHE_KEY_CATEGORY = 'recipes:category';

  constructor(
    @InjectModel(Recipe.name) private recipeModel: Model<RecipeDocument>,
    private readonly redisService: RedisService,
    private readonly imageUploadService: ImageUploadService,
  ) {}


  private processComponents(components: any[]): any[] {
    return components.map((wrapper) => {
      return {
        prepShortDescription: wrapper.prepShortDescription,
        prepLongDescription: wrapper.prepLongDescription,
        variantTags: wrapper.variantTags || [],
        stronglyRecommended: wrapper.stronglyRecommended || false,
        choiceInstructions: wrapper.choiceInstructions,
        buttonText: wrapper.buttonText,
        // Support both `component` and `components` keys from the client
        component: (
          Array.isArray(wrapper.component)
            ? wrapper.component
            : Array.isArray((wrapper as any).components)
            ? (wrapper as any).components
            : []
        ).map((comp: any) => ({
          componentTitle: comp.componentTitle,
          componentInstructions: comp.componentInstructions,
          includedInVariants: comp.includedInVariants || [],

          requiredIngredients: (comp.requiredIngredients || []).map(
            (reqIng: any) => ({
              recommendedIngredient: new Types.ObjectId(
                reqIng.recommendedIngredient,
              ),
              quantity: reqIng.quantity,
              preparation: reqIng.preparation,

              alternativeIngredients: (
                reqIng.alternativeIngredients || []
              ).map((altIng: any) => ({
                ingredient: new Types.ObjectId(altIng.ingredient),
                inheritQuantity: altIng.inheritQuantity || false,
                inheritPreparation: altIng.inheritPreparation || false,
                quantity: altIng.quantity,
                preparation: altIng.preparation,
              })),
            }),
          ),

          optionalIngredients: (comp.optionalIngredients || []).map(
            (optIng: any) => ({
              ingredient: new Types.ObjectId(optIng.ingredient),
              quantity: optIng.quantity,
              preparation: optIng.preparation,
            }),
          ),

          componentSteps: (comp.componentSteps || []).map((step: any) => ({
            stepInstructions: step.stepInstructions,
            hackOrTipIds: (step.hackOrTipIds || []).map(
              (id: string) => new Types.ObjectId(id),
            ),
            alwaysShow: step.alwaysShow || false,
            relevantIngredients: (step.relevantIngredients || []).map(
              (id: string) => new Types.ObjectId(id),
            ),
          })),
        })),
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
      // Debug: log processed structure for the first wrapper/component
      if (processedComponents?.length) {
        const firstWrapper = processedComponents[0] as any;
        const firstComp = Array.isArray(firstWrapper?.component)
          ? firstWrapper.component[0]
          : undefined;
        // Using console.log here to ensure visibility even if Nest logger level changes
        console.log('RecipeService.processedComponents count:', processedComponents.length);
        console.log('RecipeService.firstWrapper keys:', Object.keys(firstWrapper || {}));
        if (firstComp) {
          console.log('RecipeService.firstComponent keys:', Object.keys(firstComp));
        }
      }

      const recipeData: any = {
        ...createRecipeDto,
        heroImageUrl: heroImageUrl || createRecipeDto.heroImageUrl,
        hackOrTipIds: (createRecipeDto.hackOrTipIds || []).map(
          (id) => new Types.ObjectId(id),
        ),
        frameworkCategories: createRecipeDto.frameworkCategories.map(
          (id) => new Types.ObjectId(id),
        ),
        useLeftoversIn: (createRecipeDto.useLeftoversIn || []).map(
          (id) => new Types.ObjectId(id),
        ),
        stickerId: createRecipeDto.stickerId
          ? new Types.ObjectId(createRecipeDto.stickerId)
          : undefined,
        sponsorId: createRecipeDto.sponsorId
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

      return savedRecipe;
    } catch (error) {
      throw new BadRequestException(
        `Failed to create recipe: ${error.message}`,
      );
    }
  }

 
  async findAll(): Promise<Recipe[]> {
    try {
      const cached = await this.redisService.get(this.CACHE_KEY_ALL);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error parsing cached recipes, clearing cache:', error.message);
      await this.redisService.del(this.CACHE_KEY_ALL);
    }

    const recipes = await this.recipeModel
      .find({ isActive: true })
      .populate('hackOrTipIds')
      .populate('stickerId')
      .populate('frameworkCategories')
      .populate('sponsorId')
      .populate('useLeftoversIn')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
      })
      .sort({ order: 1 })
      .lean()
      .exec();

    await this.redisService.set(
      this.CACHE_KEY_ALL,
      JSON.stringify(recipes),
      this.CACHE_TTL,
    );

    return recipes;
  }

  
  async findOne(id: string): Promise<Recipe> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid recipe ID format');
    }

    const cacheKey = `${this.CACHE_KEY_SINGLE}:${id}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error parsing cached recipe, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const recipe = await this.recipeModel
      .findById(id)
      .populate('hackOrTipIds')
      .populate('stickerId')
      .populate('frameworkCategories')
      .populate('sponsorId')
      .populate('useLeftoversIn')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
      })
      .lean()
      .exec();

    if (!recipe) {
      throw new NotFoundException(`Recipe with ID ${id} not found`);
    }

    await this.redisService.set(
      cacheKey,
      JSON.stringify(recipe),
      this.CACHE_TTL,
    );

    return recipe;
  }


  async findByFrameworkCategory(categoryId: string): Promise<Recipe[]> {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException('Invalid category ID format');
    }

    const cacheKey = `${this.CACHE_KEY_CATEGORY}:${categoryId}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error parsing cached recipes by category, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const recipes = await this.recipeModel
      .find({
        frameworkCategories: new Types.ObjectId(categoryId),
        isActive: true,
      })
      .populate('hackOrTipIds')
      .populate('stickerId')
      .populate('frameworkCategories')
      .populate('sponsorId')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
      })
      .sort({ order: 1 })
      .lean()
      .exec();

    await this.redisService.set(
      cacheKey,
      JSON.stringify(recipes),
      this.CACHE_TTL,
    );

    return recipes;
  }

  async findByIngredient(ingredientId: string): Promise<Recipe[]> {
    if (!Types.ObjectId.isValid(ingredientId)) {
      throw new BadRequestException('Invalid ingredient ID format');
    }

    const cacheKey = `recipes:ingredient:${ingredientId}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error parsing cached recipes by ingredient, clearing cache:', error.message);
      await this.redisService.del(cacheKey);
    }

    const ingredientObjectId = new Types.ObjectId(ingredientId);

    // Find recipes where the ingredient appears in:
    // 1. Required ingredients (recommendedIngredient)
    // 2. Alternative ingredients
    // 3. Optional ingredients
    const recipes = await this.recipeModel
      .find({
        isActive: true,
        $or: [
          { 'components.component.requiredIngredients.recommendedIngredient': ingredientObjectId },
          { 'components.component.requiredIngredients.alternativeIngredients.ingredient': ingredientObjectId },
          { 'components.component.optionalIngredients.ingredient': ingredientObjectId },
        ],
      })
      .populate('hackOrTipIds')
      .populate('stickerId')
      .populate('frameworkCategories')
      .populate('sponsorId')
      .populate('useLeftoversIn')
      .populate({
        path: 'components.component.requiredIngredients.recommendedIngredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.requiredIngredients.alternativeIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.optionalIngredients.ingredient',
        model: 'Ingredient',
      })
      .populate({
        path: 'components.component.componentSteps.hackOrTipIds',
        model: 'HackOrTip',
      })
      .populate({
        path: 'components.component.componentSteps.relevantIngredients',
        model: 'Ingredient',
      })
      .sort({ order: 1 })
      .lean()
      .exec();

    await this.redisService.set(
      cacheKey,
      JSON.stringify(recipes),
      this.CACHE_TTL,
    );

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

      if (heroImageUrl) {
        updateData.heroImageUrl = heroImageUrl;
      }

      if (updateRecipeDto.hackOrTipIds) {
        updateData.hackOrTipIds = updateRecipeDto.hackOrTipIds.map(
          (id) => new Types.ObjectId(id),
        );
      }

      if (updateRecipeDto.frameworkCategories) {
        updateData.frameworkCategories =
          updateRecipeDto.frameworkCategories.map(
            (id) => new Types.ObjectId(id),
          );
      }

      if (updateRecipeDto.useLeftoversIn) {
        updateData.useLeftoversIn = updateRecipeDto.useLeftoversIn.map(
          (id) => new Types.ObjectId(id),
        );
      }

      if (updateRecipeDto.stickerId) {
        updateData.stickerId = new Types.ObjectId(updateRecipeDto.stickerId);
      }

      if (updateRecipeDto.sponsorId) {
        updateData.sponsorId = new Types.ObjectId(updateRecipeDto.sponsorId);
      }

      if (processedComponents) {
        updateData.components = processedComponents;
      }

      const updatedRecipe = await this.recipeModel
        .findByIdAndUpdate(id, updateData, { new: true })
        .exec();

      if (!updatedRecipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found after update`);
      }

      await this.redisService.del(this.CACHE_KEY_ALL);
      await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);

      if (existingRecipe.frameworkCategories) {
        for (const catId of existingRecipe.frameworkCategories) {
          await this.redisService.del(
            `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
          );
        }
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

    if (recipe.frameworkCategories) {
      for (const catId of recipe.frameworkCategories) {
        await this.redisService.del(
          `${this.CACHE_KEY_CATEGORY}:${catId.toString()}`,
        );
      }
    }
  }
}