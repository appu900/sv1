import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MealPlan,
  MealPlanDocument,
  MealPlanStatus,
} from '../../database/schemas/meal-plan.schema';
import {
  HealthProfile,
  HealthProfileDocument,
} from '../../database/schemas/nutrition/health-profile.schema';
import {
  UserInventoryItem,
  UserInventoryItemDocument,
  FreshnessStatus,
} from '../../database/schemas/user-inventory.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { userRecipe, UserRecipeDocument } from '../../database/schemas/user.schema';
import { MealPlanAiService } from './meal-plan-ai.service';
import { CookbookaiProducer } from '../cookbookai/cookbookai.producer';
import { GenerateMealPlanDto, GenerateRecipeFromPlanDto } from './dto/meal-plan.dto';

@Injectable()
export class MealPlanService {
  private readonly logger = new Logger(MealPlanService.name);

  constructor(
    @InjectModel(MealPlan.name)
    private readonly mealPlanModel: Model<MealPlanDocument>,
    @InjectModel(HealthProfile.name)
    private readonly healthProfileModel: Model<HealthProfileDocument>,
    @InjectModel(UserInventoryItem.name)
    private readonly inventoryModel: Model<UserInventoryItemDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(userRecipe.name)
    private readonly userRecipeModel: Model<UserRecipeDocument>,
    private readonly mealPlanAi: MealPlanAiService,
    private readonly cookbookProducer: CookbookaiProducer,
  ) {}

  async generate(userId: string, dto: GenerateMealPlanDto): Promise<MealPlanDocument> {
    const user = await this.userModel
      .findById(userId)
      .select('country dietaryProfile')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const healthProfile = await this.healthProfileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .lean<HealthProfileDocument>();

    const inventoryItems = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
      })
      .select('name quantity unit freshnessStatus expiresAt')
      .sort({ expiresAt: 1 })
      .lean()
      .exec();

    const inventoryForAi = inventoryItems.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      freshness: i.freshnessStatus ?? FreshnessStatus.FRESH,
    }));

    const dietary = (user as any).dietaryProfile ?? {};

    const context = {
      requestedDays: dto.days,
      preference: dto.preference,
      country: (user as any).country,
      targets: healthProfile?.targets
        ? {
            kcal: healthProfile.targets.kcal,
            protein_g: healthProfile.targets.protein_g,
            carbs_g: healthProfile.targets.carbs_g,
            fat_g: healthProfile.targets.fat_g,
            fiber_g: healthProfile.targets.fiber_g,
          }
        : undefined,
      goalType: healthProfile?.goal ?? undefined,
      dietary: {
        vegType: dietary.vegType,
        dairyFree: dietary.dairyFree,
        nutFree: dietary.nutFree,
        glutenFree: dietary.glutenFree,
        hasDiabetes: dietary.hasDiabetes,
        otherAllergies: dietary.otherAllergies ?? [],
        tastePreference: dietary.tastePrefrence ?? [],
      },
      inventory: inventoryForAi,
    };

    const aiResult = await this.mealPlanAi.generateMealPlan(context);

    await this.mealPlanModel.updateMany(
      { userId: new Types.ObjectId(userId), status: MealPlanStatus.ACTIVE },
      { status: MealPlanStatus.ARCHIVED },
    );

    const plan = await this.mealPlanModel.create({
      userId: new Types.ObjectId(userId),
      title: aiResult.title,
      totalDays: aiResult.totalDays,
      days: aiResult.days,
      healthGoal: aiResult.healthGoal,
      country: (user as any).country ?? '',
      status: MealPlanStatus.ACTIVE,
      targetKcal: healthProfile?.targets?.kcal,
      dietarySnapshot: dietary,
    });

    this.logger.log(`Meal plan generated: planId=${plan._id}, userId=${userId}, days=${aiResult.totalDays}`);
    return plan;
  }

  async getActivePlan(userId: string): Promise<MealPlanDocument | null> {
    return this.mealPlanModel
      .findOne({ userId: new Types.ObjectId(userId), status: MealPlanStatus.ACTIVE })
      .lean<MealPlanDocument>()
      .exec();
  }

  async getPlanHistory(userId: string): Promise<MealPlanDocument[]> {
    return this.mealPlanModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<MealPlanDocument[]>()
      .exec();
  }

  async getPlanById(userId: string, planId: string): Promise<MealPlanDocument> {
    if (!Types.ObjectId.isValid(planId)) throw new BadRequestException('Invalid plan ID');

    const plan = await this.mealPlanModel
      .findOne({ _id: new Types.ObjectId(planId), userId: new Types.ObjectId(userId) })
      .lean<MealPlanDocument>()
      .exec();

    if (!plan) throw new NotFoundException('Meal plan not found');
    return plan;
  }

  async archivePlan(userId: string, planId: string): Promise<void> {
    if (!Types.ObjectId.isValid(planId)) throw new BadRequestException('Invalid plan ID');

    const result = await this.mealPlanModel.updateOne(
      { _id: new Types.ObjectId(planId), userId: new Types.ObjectId(userId) },
      { status: MealPlanStatus.ARCHIVED },
    );
    if (!result.matchedCount) throw new NotFoundException('Meal plan not found');
  }

  async generateRecipeFromMeal(
    userId: string,
    dto: GenerateRecipeFromPlanDto,
  ): Promise<{ recipeId: string }> {
    const plan = await this.getPlanById(userId, dto.planId);

    const day = (plan.days ?? []).find((d) => d.dayNumber === dto.dayNumber);
    if (!day) throw new NotFoundException(`Day ${dto.dayNumber} not found in plan`);

    const meal = day.meals.find((m) => m.slot === dto.slot);
    if (!meal) throw new NotFoundException(`Meal slot "${dto.slot}" not found on day ${dto.dayNumber}`);

    if (!meal.ingredients?.length) {
      throw new BadRequestException('This meal has no ingredients to generate a recipe from');
    }

    const pendingRecipe = await this.userRecipeModel.create({
      userid: userId,
      status: 'pending',
      title: meal.title,
      shortDescription: '',
      longDescription: '',
      heroImageUrl: '',
      youtubeId: '',
      portions: '',
      prepCookTime: 0,
      hackOrTipIds: [],
      frameworkCategories: [],
      useLeftoversIn: [],
      countries: [],
      components: [],
      isActive: true,
      source: 'ai_ingredients',
    });

    const recipeId = String(pendingRecipe._id);

    const user = await this.userModel.findById(userId).select('country').lean();
    const country = (user as any)?.country;

    const slotLabel =
      ({ breakfast: 'breakfast', lunch: 'lunch', snack: 'snack', dinner: 'dinner' } as Record<string, string>)[dto.slot] ??
      dto.slot;
    const preference =
      `Generate the complete step-by-step recipe for "${meal.title}"` +
      (meal.description ? ` — ${meal.description}` : '') +
      `. This is a ${slotLabel} dish from day ${dto.dayNumber} of the meal plan "${plan.title}".` +
      ` Make it practical, delicious and culturally appropriate.`;
    await this.cookbookProducer.enqueueRecipeFromIngredients(
      userId,
      meal.ingredients,
      preference,
      recipeId,
      country,
    );

    await this.mealPlanModel.updateOne(
      {
        _id: new Types.ObjectId(dto.planId),
        userId: new Types.ObjectId(userId),
        'days.dayNumber': dto.dayNumber,
      },
      {
        $set: {
          'days.$[day].meals.$[meal].generatedRecipeId': new Types.ObjectId(recipeId),
        },
      },
      {
        arrayFilters: [
          { 'day.dayNumber': dto.dayNumber },
          { 'meal.slot': dto.slot },
        ],
      },
    );

    this.logger.log(`Recipe queued: planId=${dto.planId}, day=${dto.dayNumber}, slot=${dto.slot}, recipeId=${recipeId}`);
    return { recipeId };
  }
}
