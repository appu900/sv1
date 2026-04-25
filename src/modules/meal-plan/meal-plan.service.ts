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
  MealPlanDuration,
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
import { UserEventService } from '../user-events/user-event.service';
import { UserEventType } from '../../database/schemas/user-event.schema';
import { SubscriptionService } from '../subscription/subscription.service';

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
    private readonly userEventService: UserEventService,
    private readonly mealPlanAi: MealPlanAiService,
    private readonly cookbookProducer: CookbookaiProducer,
    private readonly subscriptionService: SubscriptionService,
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

    await this.subscriptionService.incrementUsage(userId, 'aiMealsUsed');

    let aiResult: Awaited<ReturnType<MealPlanAiService['generateMealPlan']>>;
    try {
      aiResult = await this.mealPlanAi.generateMealPlan(context, userId);
    } catch (error) {
      await this.subscriptionService
        .refundUsage(userId, 'aiMealsUsed')
        .catch(() => undefined);
      throw error;
    }

    await this.mealPlanModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        status: { $in: [MealPlanStatus.ACTIVE, MealPlanStatus.CREATED, MealPlanStatus.STARTED] },
      },
      { status: MealPlanStatus.ARCHIVED },
    );

    const plan = await this.mealPlanModel.create({
      userId: new Types.ObjectId(userId),
      title: aiResult.title,
      totalDays: aiResult.totalDays,
      days: aiResult.days,
      healthGoal: aiResult.healthGoal,
      country: (user as any).country ?? '',
      status: MealPlanStatus.CREATED,
      targetKcal: healthProfile?.targets?.kcal,
      // Analytics fields
      duration: this.bucketDuration(aiResult.totalDays ?? dto.days),
      customDurationDays:
        this.bucketDuration(aiResult.totalDays ?? dto.days) ===
        MealPlanDuration.CUSTOM
          ? aiResult.totalDays ?? dto.days
          : undefined,
      planType:
        (dto as any)?.preference ||
        healthProfile?.goal ||
        'unspecified',
      recipes: [],
      aiEventId: aiResult.aiEventId
        ? new Types.ObjectId(aiResult.aiEventId)
        : null,
    });

    this.logger.log(`Meal plan generated: planId=${plan._id}, userId=${userId}, days=${aiResult.totalDays}`);

    // Funnel event: first meal plan created by this user.
    void this.userEventService.recordFirst(
      userId,
      UserEventType.FIRST_MEAL_PLAN_CREATED,
      {
        planId: plan._id.toString(),
        duration: plan.duration,
        planType: plan.planType,
      },
    );

    return plan;
  }

  private bucketDuration(days: number | undefined): MealPlanDuration {
    if (days === 3) return MealPlanDuration.THREE;
    if (days === 5) return MealPlanDuration.FIVE;
    if (days === 7) return MealPlanDuration.SEVEN;
    return MealPlanDuration.CUSTOM;
  }

  async getActivePlan(userId: string): Promise<MealPlanDocument | null> {
    return this.mealPlanModel
      .findOne({
        userId: new Types.ObjectId(userId),
        status: {
          $in: [
            MealPlanStatus.ACTIVE,
            MealPlanStatus.CREATED,
            MealPlanStatus.STARTED,
          ],
        },
      })
      .sort({ createdAt: -1 })
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

    if (meal.generatedRecipeId) {
      return { recipeId: String(meal.generatedRecipeId) };
    }

    if (!meal.ingredients?.length) {
      throw new BadRequestException('This meal has no ingredients to generate a recipe from');
    }

    const currentRecipeCount = await this.userRecipeModel
      .countDocuments({ userid: userId, isActive: { $ne: false } })
      .exec();
    await this.subscriptionService.enforceLiveLimit(
      userId,
      'cookbooks',
      currentRecipeCount,
      1,
    );
    await this.subscriptionService.incrementUsage(userId, 'aiMealsUsed');

    let pendingRecipe: UserRecipeDocument;
    try {
      pendingRecipe = await this.userRecipeModel.create({
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
        importSource: 'mealplan',
      });
    } catch (error) {
      await this.subscriptionService
        .refundUsage(userId, 'aiMealsUsed')
        .catch(() => undefined);
      throw error;
    }

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
    try {
      await this.cookbookProducer.enqueueRecipeFromIngredients(
        userId,
        meal.ingredients,
        preference,
        recipeId,
        country,
      );
    } catch (error) {
      await this.subscriptionService
        .refundUsage(userId, 'aiMealsUsed')
        .catch(() => undefined);
      await this.userRecipeModel
        .deleteOne({ _id: pendingRecipe._id, userid: userId, status: 'pending' })
        .catch(() => undefined);
      throw error;
    }

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

  /** Mark a plan as STARTED (idempotent). Returns the updated plan. */
  async startPlan(userId: string, planId: string): Promise<MealPlanDocument> {
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException('Invalid plan ID');
    }
    const filter = {
      _id: new Types.ObjectId(planId),
      userId: new Types.ObjectId(userId),
    };
    const existing = await this.mealPlanModel.findOne(filter).lean();
    if (!existing) throw new NotFoundException('Meal plan not found');

    if (existing.status === MealPlanStatus.STARTED) return existing as MealPlanDocument;
    if (existing.status === MealPlanStatus.COMPLETED) {
      return existing as MealPlanDocument;
    }

    const updated = await this.mealPlanModel
      .findOneAndUpdate(
        filter,
        {
          $set: { status: MealPlanStatus.STARTED },
          ...(existing.startedAt ? {} : { $setOnInsert: { startedAt: new Date() } }),
        },
        { new: true },
      )
      .lean<MealPlanDocument>();

    if (updated && !updated.startedAt) {
      await this.mealPlanModel.updateOne(filter, { $set: { startedAt: new Date() } });
      (updated as any).startedAt = new Date();
    }
    return updated!;
  }

  /** Mark a plan as COMPLETED (idempotent). */
  async completePlan(userId: string, planId: string): Promise<MealPlanDocument> {
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException('Invalid plan ID');
    }
    const filter = {
      _id: new Types.ObjectId(planId),
      userId: new Types.ObjectId(userId),
    };
    const existing = await this.mealPlanModel.findOne(filter).lean();
    if (!existing) throw new NotFoundException('Meal plan not found');

    if (existing.status === MealPlanStatus.COMPLETED) {
      return existing as MealPlanDocument;
    }

    const updated = await this.mealPlanModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            status: MealPlanStatus.COMPLETED,
            completedAt: new Date(),
            ...(existing.startedAt ? {} : { startedAt: new Date() }),
          },
        },
        { new: true },
      )
      .lean<MealPlanDocument>();

    return updated!;
  }

  /**
   * Upsert a recipe entry in `plan.recipes[]` keyed by (dayIndex, mealSlot).
   * Used when user marks a meal as cooked or swapped from the meal plan UI.
   * Auto-completes the plan when every slot in `days[].meals[]` is cooked.
   */
  async markPlanRecipe(
    userId: string,
    planId: string,
    params: {
      dayIndex: number;
      mealSlot: string;
      recipeId?: string;
      isCooked?: boolean;
      isSwapped?: boolean;
    },
  ): Promise<MealPlanDocument> {
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException('Invalid plan ID');
    }
    if (!Number.isInteger(params.dayIndex) || params.dayIndex < 0) {
      throw new BadRequestException('Invalid dayIndex');
    }
    if (!params.mealSlot || typeof params.mealSlot !== 'string') {
      throw new BadRequestException('Invalid mealSlot');
    }

    const filter = {
      _id: new Types.ObjectId(planId),
      userId: new Types.ObjectId(userId),
    };
    const plan = await this.mealPlanModel.findOne(filter);
    if (!plan) throw new NotFoundException('Meal plan not found');

    const recipeObjectId =
      params.recipeId && Types.ObjectId.isValid(params.recipeId)
        ? new Types.ObjectId(params.recipeId)
        : undefined;

    const entry = plan.recipes.find(
      (r) => r.dayIndex === params.dayIndex && r.mealSlot === params.mealSlot,
    );

    if (entry) {
      if (recipeObjectId) entry.recipeId = recipeObjectId;
      if (typeof params.isCooked === 'boolean') {
        entry.isCooked = params.isCooked;
        if (params.isCooked && !entry.cookedAt) entry.cookedAt = new Date();
        if (!params.isCooked) entry.cookedAt = undefined;
      }
      if (typeof params.isSwapped === 'boolean') entry.isSwapped = params.isSwapped;
    } else {
      if (!recipeObjectId) {
        throw new BadRequestException('recipeId is required when adding a new entry');
      }
      plan.recipes.push({
        recipeId: recipeObjectId,
        dayIndex: params.dayIndex,
        mealSlot: params.mealSlot,
        isCooked: !!params.isCooked,
        isSwapped: !!params.isSwapped,
        cookedAt: params.isCooked ? new Date() : undefined,
      } as any);
    }

    if (plan.status === MealPlanStatus.CREATED) {
      plan.status = MealPlanStatus.STARTED;
      if (!plan.startedAt) plan.startedAt = new Date();
    }

    const totalSlots = (plan.days || []).reduce(
      (sum, d) => sum + (d.meals?.length || 0),
      0,
    );
    const cookedSlots = plan.recipes.filter((r) => r.isCooked).length;
    if (totalSlots > 0 && cookedSlots >= totalSlots && plan.status !== MealPlanStatus.COMPLETED) {
      plan.status = MealPlanStatus.COMPLETED;
      plan.completedAt = new Date();
    }

    await plan.save();
    return plan.toObject() as MealPlanDocument;
  }
}
