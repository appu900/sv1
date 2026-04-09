import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ConfidenceLevel,
  DailyIntake,
  DailyIntakeDocument,
  DailyIntakeEntry,
  DayTotals,
  LogRefKind,
  PortionMode,
} from '../../database/schemas/nutrition/daily-intake.schema';
import {
  FoodItemDocument,
  NutritionPer100g,
  ServingOption,
} from '../../database/schemas/nutrition/food-item.schema';
import {
  CustomFoodNutrition,
  UserCustomFoodDocument,
} from '../../database/schemas/nutrition/user-custom-food.schema';
import {
  HealthProfile,
  HealthProfileDocument,
} from '../../database/schemas/nutrition/health-profile.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { resolveTimezone, localDateISO } from '../../common/utils/timezone.util';
import { FoodItemService } from './food-item.service';
import { UserCustomFoodService } from './user-custom-food.service';
import {
  CreateLogEntryDto,
  EntryPortionDto,
  EntryRefDto,
  UpdateLogEntryDto,
} from './dto/log-entry.dto';
import { NutritionFactsDto } from './dto/custom-food.dto';

interface ResolvedNutrition {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  resolvedGrams: number;
  confidence: ConfidenceLevel;
  sourceLabel: string;
}

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    @InjectModel(DailyIntake.name)
    private readonly dailyModel: Model<DailyIntakeDocument>,
    @InjectModel(HealthProfile.name)
    private readonly profileModel: Model<HealthProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly foodItemService: FoodItemService,
    private readonly userCustomFoodService: UserCustomFoodService,
  ) {}

  async logEntry(
    userId: string,
    dto: CreateLogEntryDto,
  ): Promise<{ entry: DailyIntakeEntry; daily: DailyIntakeDocument }> {
    this.validateRefDto(dto.ref);

    const date = dto.date ?? await this.todayISO(userId);
    const computed = await this.resolveNutrition(userId, dto.ref, dto.portion, dto.freeformFacts);

    const entry: any = {
      _id: new Types.ObjectId(),
      at: new Date(),
      mealSlot: dto.mealSlot ?? null,
      ref: this.buildRef(dto.ref),
      portion: this.buildPortion(dto.portion),
      computed,
    };

    const existingDaily = await this.dailyModel
      .findOne({ userId: new Types.ObjectId(userId), date })
      .select('_id')
      .lean()
      .exec();

    const setOnInsertData: any = {
      userId: new Types.ObjectId(userId),
      date,
    };
    if (!existingDaily) {
      const profileTargets = await this.getActiveTargets(userId);
      if (profileTargets) {
        setOnInsertData.targets = {
          kcal: profileTargets.kcal,
          protein_g: profileTargets.protein_g,
          carbs_g: profileTargets.carbs_g,
          fat_g: profileTargets.fat_g,
          fiber_g: profileTargets.fiber_g ?? 0,
          water_ml: profileTargets.water_ml ?? 0,
        };
      }
    }

    const daily = await this.dailyModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      {
        $push: { entries: entry },
        $setOnInsert: setOnInsertData,
      },
      { new: true, upsert: true },
    ).exec();

    const prev = daily.totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
    daily.totals = {
      kcal: round(prev.kcal + (computed.kcal ?? 0)),
      protein_g: round(prev.protein_g + (computed.protein_g ?? 0)),
      carbs_g: round(prev.carbs_g + (computed.carbs_g ?? 0)),
      fat_g: round(prev.fat_g + (computed.fat_g ?? 0)),
      fiber_g: round(prev.fiber_g + (computed.fiber_g ?? 0)),
    };
    await daily.save();

    const dailyObj = daily.toObject() as DailyIntakeDocument;

    if (!this.hasCompleteTargets(dailyObj.targets)) {
      const fallbackTargets = await this.getActiveTargets(userId);
      if (fallbackTargets) {
        const prev: Record<string, number> = (dailyObj as any).targets ?? {};
        const merged = {
          kcal: (prev.kcal ?? 0) > 0 ? prev.kcal : fallbackTargets.kcal,
          protein_g: prev.protein_g ?? fallbackTargets.protein_g,
          carbs_g: prev.carbs_g ?? fallbackTargets.carbs_g,
          fat_g: prev.fat_g ?? fallbackTargets.fat_g,
          fiber_g: prev.fiber_g ?? fallbackTargets.fiber_g,
          water_ml: prev.water_ml ?? fallbackTargets.water_ml,
        };
        await this.dailyModel.updateOne({ _id: dailyObj._id }, { $set: { targets: merged } }).exec();
        dailyObj.targets = merged as any;
      }
    }

    return { entry, daily: dailyObj };
  }

  async getDaily(userId: string, date?: string): Promise<DailyIntakeDocument | null> {
    const d = date ?? await this.todayISO(userId);
    const doc = await this.dailyModel
      .findOne({ userId: new Types.ObjectId(userId), date: d })
      .lean<DailyIntakeDocument>()
      .exec();
    if (!doc) {
      return null;
    }

    if (this.hasCompleteTargets(doc.targets)) {
      return doc;
    }

    const fallbackTargets = await this.getActiveTargets(userId);
    if (!fallbackTargets) {
      return doc;
    }

    const curr = doc.targets ?? ({} as any);
    const mergedTargets = {
      kcal: (curr.kcal ?? 0) > 0 ? curr.kcal : fallbackTargets.kcal,
      protein_g: Number.isFinite(curr.protein_g) ? curr.protein_g : fallbackTargets.protein_g,
      carbs_g: Number.isFinite(curr.carbs_g) ? curr.carbs_g : fallbackTargets.carbs_g,
      fat_g: Number.isFinite(curr.fat_g) ? curr.fat_g : fallbackTargets.fat_g,
      fiber_g: Number.isFinite(curr.fiber_g) ? curr.fiber_g : fallbackTargets.fiber_g,
      water_ml: Number.isFinite(curr.water_ml) ? curr.water_ml : fallbackTargets.water_ml,
    };

    await this.dailyModel
      .updateOne({ _id: doc._id }, { $set: { targets: mergedTargets } })
      .exec();

    return {
      ...doc,
      targets: mergedTargets,
    } as DailyIntakeDocument;
  }

  async getDailyHistory(
    userId: string,
    month: string,
  ): Promise<
    {
      date: string;
      totals: DayTotals;
      targets: DailyIntakeDocument['targets'] | null;
      water_ml: number;
      dailyRecommendation: {
        recommendations: string[];
        generatedAt?: Date | null;
      } | null;
    }[]
  > {
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monthStr, 10);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const docs = await this.dailyModel
      .find({
        userId: new Types.ObjectId(userId),
        date: { $gte: startDate, $lte: endDate },
      })
      .select('date totals targets waterIntake.total_ml dailyRecommendation.recommendations dailyRecommendation.generatedAt')
      .sort({ date: 1 })
      .lean()
      .exec();

    const docsByDate = new Map(
      docs.map((doc: any) => [doc.date, doc]),
    );

    const todayStr = await this.todayISO(userId);
    const todayMonth = todayStr.slice(0, 7);
    const maxDay = (month === todayMonth)
      ? Math.min(lastDay, parseInt(todayStr.slice(8, 10), 10))
      : lastDay;

    return Array.from({ length: maxDay }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      const date = `${month}-${day}`;
      const doc: any = docsByDate.get(date);

      return {
        date,
        totals: doc?.totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        targets: doc?.targets ?? null,
        water_ml: doc?.waterIntake?.total_ml ?? 0,
        dailyRecommendation: doc?.dailyRecommendation
          ? {
              recommendations: doc.dailyRecommendation.recommendations ?? [],
              generatedAt: doc.dailyRecommendation.generatedAt ?? null,
            }
          : null,
      };
    });
  }

  async deleteEntry(
    userId: string,
    entryId: string,
  ): Promise<DailyIntakeDocument> {
    const daily = await this.dailyModel
      .findOne({
        userId: new Types.ObjectId(userId),
        'entries._id': new Types.ObjectId(entryId),
      })
      .exec();

    if (!daily) {
      throw new NotFoundException('Entry not found');
    }

    const entryToRemove = (daily.entries as any[]).find(
      (e: any) => String(e._id) === entryId,
    );
    daily.entries = (daily.entries as any[]).filter(
      (e: any) => String(e._id) !== entryId,
    );
    const rc = entryToRemove?.computed;
    if (rc) {
      const prev = daily.totals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
      daily.totals = {
        kcal: round(Math.max(0, prev.kcal - (rc.kcal ?? 0))),
        protein_g: round(Math.max(0, prev.protein_g - (rc.protein_g ?? 0))),
        carbs_g: round(Math.max(0, prev.carbs_g - (rc.carbs_g ?? 0))),
        fat_g: round(Math.max(0, prev.fat_g - (rc.fat_g ?? 0))),
        fiber_g: round(Math.max(0, prev.fiber_g - (rc.fiber_g ?? 0))),
      };
    } else {
      daily.totals = this.recomputeTotals(daily.entries);
    }
    await daily.save();

    return daily.toObject() as DailyIntakeDocument;
  }

  async updateEntry(
    userId: string,
    entryId: string,
    dto: UpdateLogEntryDto,
  ): Promise<{ entry: any; daily: DailyIntakeDocument }> {
    const daily = await this.dailyModel
      .findOne({
        userId: new Types.ObjectId(userId),
        'entries._id': new Types.ObjectId(entryId),
      })
      .exec();

    if (!daily) {
      throw new NotFoundException('Entry not found');
    }

    const entryIdx = (daily.entries as any[]).findIndex(
      (e: any) => String(e._id) === entryId,
    );
    if (entryIdx === -1) throw new NotFoundException('Entry not found');

    const existing = (daily.entries as any[])[entryIdx];

    if (dto.ref) {
      this.validateRefDto(dto.ref);
      const computed = await this.resolveNutrition(
        userId,
        dto.ref,
        dto.portion ?? existing.portion,
        dto.freeformFacts,
      );
      existing.ref = this.buildRef(dto.ref);
      if (dto.portion) {
        existing.portion = this.buildPortion(dto.portion);
      }
      existing.computed = computed;
    } else if (dto.portion) {
      const computed = await this.resolveNutrition(
        userId,
        existing.ref,
        dto.portion,
        undefined,
      );
      existing.portion = this.buildPortion(dto.portion);
      existing.computed = computed;
    }

    if (dto.mealSlot !== undefined) {
      existing.mealSlot = dto.mealSlot;
    }

    daily.totals = this.recomputeTotals(daily.entries);
    await daily.save();

    return {
      entry: existing.toObject ? existing.toObject() : existing,
      daily: daily.toObject() as DailyIntakeDocument,
    };
  }

  async resolveNutrition(
    userId: string,
    ref: EntryRefDto,
    portion: EntryPortionDto,
    freeformFacts?: NutritionFactsDto,
  ): Promise<ResolvedNutrition> {
    switch (ref.kind) {
      case LogRefKind.FOOD:
        return this.resolveFromFoodItem(ref.foodItemId!, portion);

      case LogRefKind.CUSTOM:
        return this.resolveFromCustomFood(userId, ref.customFoodId!, portion);

      case LogRefKind.FREEFORM:
        return this.resolveFromFreeform(ref.freeformText!, freeformFacts);

      case LogRefKind.RECIPE:
      case LogRefKind.USER_RECIPE:
        throw new BadRequestException(
          'Recipe logging is not yet supported. Coming in Step 7.',
        );

      default:
        throw new BadRequestException(`Unknown ref kind: ${ref.kind}`);
    }
  }


  private async resolveFromFoodItem(
    foodItemId: string,
    portion: EntryPortionDto,
  ): Promise<ResolvedNutrition> {
    const food: FoodItemDocument = await this.foodItemService.findById(foodItemId);
    const grams = this.resolvePortionToGrams(
      portion,
      food.servingOptions ?? [],
      food.gramsPerMl ?? null,
    );

    return {
      ...this.scaleNutrition(food.per100g, grams),
      resolvedGrams: round(grams),
      confidence: food.verified
        ? ConfidenceLevel.VERIFIED
        : ConfidenceLevel.ESTIMATED,
      sourceLabel: (food.displayName || food.canonicalName || food.source || 'catalog').slice(0, 60),
    };
  }


  private async resolveFromCustomFood(
    userId: string,
    customFoodId: string,
    portion: EntryPortionDto,
  ): Promise<ResolvedNutrition> {
    const custom: UserCustomFoodDocument =
      await this.userCustomFoodService.findOne(userId, customFoodId);

    if (custom.per100g && custom.per100g.kcal != null) {
      const grams = this.resolveCustomPortionToGrams(portion, custom);
      return {
        ...this.scaleNutrition(custom.per100g as any, grams),
        resolvedGrams: round(grams),
        confidence: ConfidenceLevel.USER_ENTERED,
        sourceLabel: custom.name || 'Custom food',
      };
    }

    if (custom.perServing && custom.perServing.kcal != null) {
      const servings = this.resolveServingsCount(portion, custom);
      return {
        ...this.scaleByServings(custom.perServing, servings),
        resolvedGrams: round((custom.servingGrams ?? 0) * servings),
        confidence: ConfidenceLevel.USER_ENTERED,
        sourceLabel: custom.name || 'Custom food',
      };
    }

    throw new BadRequestException(
      'Custom food has no nutrition data. Please update it first.',
    );
  }


  private resolveFromFreeform(
    freeformText: string,
    freeformFacts?: NutritionFactsDto,
  ): ResolvedNutrition {
    if (!freeformFacts) {
      throw new BadRequestException(
        'Freeform entries require freeformFacts with at least kcal.',
      );
    }
    return {
      kcal: round(freeformFacts.kcal),
      protein_g: round(freeformFacts.protein_g ?? 0),
      carbs_g: round(freeformFacts.carbs_g ?? 0),
      fat_g: round(freeformFacts.fat_g ?? 0),
      fiber_g: round(freeformFacts.fiber_g ?? 0),
      resolvedGrams: 0,
      confidence: ConfidenceLevel.USER_ENTERED,
      sourceLabel: freeformText || 'Quick add',
    };
  }

  resolvePortionToGrams(
    portion: EntryPortionDto,
    servingOptions: ServingOption[],
    gramsPerMl: number | null,
  ): number {
    switch (portion.mode) {
      case PortionMode.GRAMS:
        return portion.grams ?? 0;

      case PortionMode.ML: {
        const density = gramsPerMl ?? 1.0;
        return (portion.ml ?? 0) * density;
      }

      case PortionMode.SERVING: {
        const opt = this.findServingOption(portion.label, servingOptions);
        const servings = portion.servings ?? 1;
        return opt.grams * servings;
      }

      case PortionMode.COUNT: {
        const defaultOpt = this.getDefaultServing(servingOptions);
        const count = portion.servings ?? 1;
        return defaultOpt.grams * count;
      }

      default:
        throw new BadRequestException(`Unknown portion mode: ${portion.mode}`);
    }
  }

  private resolveCustomPortionToGrams(
    portion: EntryPortionDto,
    custom: UserCustomFoodDocument,
  ): number {
    switch (portion.mode) {
      case PortionMode.GRAMS:
        return portion.grams ?? 0;

      case PortionMode.SERVING:
      case PortionMode.COUNT: {
        const servings = portion.servings ?? 1;
        if (!custom.servingGrams) {
          throw new BadRequestException(
            'This custom food has no serving weight. Use grams mode or update the food.',
          );
        }
        return custom.servingGrams * servings;
      }

      case PortionMode.ML:
        throw new BadRequestException(
          'Volume portions are not supported for custom foods.',
        );

      default:
        throw new BadRequestException(`Unknown portion mode: ${portion.mode}`);
    }
  }

  private resolveServingsCount(
    portion: EntryPortionDto,
    custom: UserCustomFoodDocument,
  ): number {
    switch (portion.mode) {
      case PortionMode.SERVING:
      case PortionMode.COUNT:
        return portion.servings ?? 1;

      case PortionMode.GRAMS: {
        if (!custom.servingGrams || custom.servingGrams <= 0) {
          throw new BadRequestException(
            'Cannot convert grams to servings: serving weight unknown. Use serving mode.',
          );
        }
        return (portion.grams ?? 0) / custom.servingGrams;
      }

      case PortionMode.ML:
        throw new BadRequestException(
          'Volume portions are not supported for custom foods.',
        );

      default:
        return 1;
    }
  }

  private scaleNutrition(
    per100g: NutritionPer100g | CustomFoodNutrition,
    grams: number,
  ): Pick<ResolvedNutrition, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'> {
    const factor = grams / 100;
    return {
      kcal: round(per100g.kcal * factor),
      protein_g: round((per100g.protein_g ?? 0) * factor),
      carbs_g: round((per100g.carbs_g ?? 0) * factor),
      fat_g: round((per100g.fat_g ?? 0) * factor),
      fiber_g: round((per100g.fiber_g ?? 0) * factor),
    };
  }

  private scaleByServings(
    perServing: CustomFoodNutrition,
    servings: number,
  ): Pick<ResolvedNutrition, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'> {
    return {
      kcal: round(perServing.kcal * servings),
      protein_g: round((perServing.protein_g ?? 0) * servings),
      carbs_g: round((perServing.carbs_g ?? 0) * servings),
      fat_g: round((perServing.fat_g ?? 0) * servings),
      fiber_g: round((perServing.fiber_g ?? 0) * servings),
    };
  }

  private recomputeTotals(entries: DailyIntakeEntry[]): DayTotals {
    const totals: DayTotals = {
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    };
    for (const e of entries) {
      const c = e.computed;
      if (!c) continue;
      totals.kcal += c.kcal ?? 0;
      totals.protein_g += c.protein_g ?? 0;
      totals.carbs_g += c.carbs_g ?? 0;
      totals.fat_g += c.fat_g ?? 0;
      totals.fiber_g += c.fiber_g ?? 0;
    }
    totals.kcal = round(totals.kcal);
    totals.protein_g = round(totals.protein_g);
    totals.carbs_g = round(totals.carbs_g);
    totals.fat_g = round(totals.fat_g);
    totals.fiber_g = round(totals.fiber_g);
    return totals;
  }


  private findServingOption(
    label: string | undefined | null,
    options: ServingOption[],
  ): ServingOption {
    if (!options.length) {
      throw new BadRequestException(
        'This food has no serving options. Use grams or count mode.',
      );
    }
    if (label) {
      const match = options.find(
        (o) => o.label.toLowerCase() === label.toLowerCase(),
      );
      if (match) return match;
    }
    return this.getDefaultServing(options);
  }

  private getDefaultServing(options: ServingOption[]): ServingOption {
    if (!options.length) {
      throw new BadRequestException(
        'This food has no serving options. Use grams mode.',
      );
    }
    return options.find((o) => o.isDefault) ?? options[0];
  }

  private validateRefDto(ref: EntryRefDto): void {
    switch (ref.kind) {
      case LogRefKind.FOOD:
        if (!ref.foodItemId)
          throw new BadRequestException('foodItemId is required for food entries');
        break;
      case LogRefKind.CUSTOM:
        if (!ref.customFoodId)
          throw new BadRequestException('customFoodId is required for custom entries');
        break;
      case LogRefKind.FREEFORM:
        if (!ref.freeformText)
          throw new BadRequestException('freeformText is required for freeform entries');
        break;
      case LogRefKind.RECIPE:
        if (!ref.recipeId)
          throw new BadRequestException('recipeId is required for recipe entries');
        break;
      case LogRefKind.USER_RECIPE:
        if (!ref.userRecipeId)
          throw new BadRequestException('userRecipeId is required for user_recipe entries');
        break;
    }
  }

  private buildRef(dto: EntryRefDto): any {
    return {
      kind: dto.kind,
      foodItemId: dto.foodItemId ? new Types.ObjectId(dto.foodItemId) : null,
      customFoodId: dto.customFoodId ? new Types.ObjectId(dto.customFoodId) : null,
      recipeId: dto.recipeId ? new Types.ObjectId(dto.recipeId) : null,
      userRecipeId: dto.userRecipeId ? new Types.ObjectId(dto.userRecipeId) : null,
      freeformText: dto.freeformText ?? null,
    };
  }

  private buildPortion(dto: EntryPortionDto): any {
    return {
      mode: dto.mode,
      label: dto.label ?? null,
      servings: dto.servings ?? null,
      grams: dto.grams ?? null,
      ml: dto.ml ?? null,
    };
  }

  async getUserLocalDate(userId: string): Promise<string> {
    return this.todayISO(userId);
  }

  async getActiveTargets(userId: string): Promise<DailyIntakeDocument['targets'] | null> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .select('targets')
      .lean()
      .exec();

    if (!profile?.targets) {
      return null;
    }

    return {
      kcal: profile.targets.kcal,
      protein_g: profile.targets.protein_g,
      carbs_g: profile.targets.carbs_g,
      fat_g: profile.targets.fat_g,
      fiber_g: profile.targets.fiber_g ?? 0,
      water_ml: profile.targets.water_ml ?? 0,
    };
  }

  private hasCompleteTargets(
    targets: DailyIntakeDocument['targets'] | null | undefined,
  ): targets is NonNullable<DailyIntakeDocument['targets']> {
    return !!targets &&
      targets.kcal > 0 &&
      [targets.protein_g, targets.carbs_g, targets.fat_g, targets.fiber_g, targets.water_ml]
        .every((value) => Number.isFinite(value));
  }

  private async todayISO(userId: string): Promise<string> {
    const user = await this.userModel
      .findById(userId)
      .select('timezone country')
      .lean();
    const tz = resolveTimezone(user?.timezone, user?.country);
    return localDateISO(tz);
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
