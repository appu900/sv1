import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import {
  HealthProfile,
  HealthProfileDocument,
  NutritionTargets,
  GoalTimeline,
  Gender,
  BodyType,
  GoalType,
  ActivityLevel,
  MonthlySnapshot,
} from '../../database/schemas/nutrition/health-profile.schema';
import {
  DailyIntake,
  DailyIntakeDocument,
} from '../../database/schemas/nutrition/daily-intake.schema';
import { CreateHealthProfileDto, UpdateHealthProfileDto, UpdateDailyTargetsDto, UpdateWeightDto, LogWaterDto } from './dto/health-profile.dto';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { resolveTimezone, localDateISO, localMonthISO } from '../../common/utils/timezone.util';
import { getCuisineContext } from '../../common/utils/country-cuisine.util';

interface AiGoalResponse {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  water_ml: number;
  estimatedWeeks?: number;
  weeklyChangeKg?: number;
  targetDate?: string;
  rationale: string;
}

@Injectable()
export class HealthProfileService {
  private readonly logger = new Logger(HealthProfileService.name);
  constructor(
    @InjectModel(HealthProfile.name)
    private readonly profileModel: Model<HealthProfileDocument>,
    @InjectModel(DailyIntake.name)
    private readonly dailyModel: Model<DailyIntakeDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject('OPENAI_CLIENT') private readonly openai: OpenAI | null,
  ) {
    if (!this.openai) {
      this.logger.warn('OPENAI_API_KEY not set — will use formula-based targets');
    }
  }

  private async getUserTz(userId: string): Promise<string> {
    const user = await this.userModel
      .findById(userId)
      .select('timezone country')
      .lean();
    return resolveTimezone(user?.timezone, user?.country);
  }

  private async getUserCountry(userId: string): Promise<string | undefined> {
    const user = await this.userModel
      .findById(userId)
      .select('country')
      .lean();
    return user?.country ?? undefined;
  }

  async getProfile(userId: string): Promise<HealthProfileDocument | null> {
    return this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .lean<HealthProfileDocument>()
      .exec();
  }

  async createProfile(
    userId: string,
    dto: CreateHealthProfileDto,
  ): Promise<HealthProfileDocument> {
    const previousProfile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .select('monthlySnapshots')
      .lean()
      .exec();

    await this.profileModel.updateMany(
      { userId: new Types.ObjectId(userId) },
      { $set: { isActive: false } },
    );

    const targets = await this.generateTargets(dto);
    const tz = await this.getUserTz(userId);
    const timeline = this.buildTimeline(dto, targets, tz);

    const profile = await this.profileModel.create({
      userId: new Types.ObjectId(userId),
      gender: dto.gender,
      age: dto.age,
      height: dto.height,
      weight: dto.weight,
      bodyType: dto.bodyType,
      activityLevel: dto.activityLevel ?? ActivityLevel.MODERATE,
      goal: dto.goal,
      targetWeightKg: dto.targetWeightKg,
      healthCondition: dto.healthCondition ?? { conditions: [], doctorRecommendation: '' },
      targets: targets.targets,
      timeline,
      aiRationale: targets.rationale,
      monthlySnapshots: previousProfile?.monthlySnapshots ?? [],
    });

    await this.syncDailyTargets(userId, targets.targets);

    return profile.toObject() as HealthProfileDocument;
  }

  async updateWeight(
    userId: string,
    dto: UpdateWeightDto,
  ): Promise<HealthProfileDocument> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) throw new NotFoundException('Health profile not found');

    profile.weight = { kg: dto.kg, lbs: dto.lbs };

    const recalcDto = {
      gender: profile.gender,
      age: profile.age,
      height: profile.height,
      weight: { kg: dto.kg, lbs: dto.lbs },
      bodyType: profile.bodyType,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
      targetWeightKg: profile.targetWeightKg,
      healthCondition: profile.healthCondition,
    } as CreateHealthProfileDto;

    const { targets, rationale } = this.generateTargetsWithFormula(recalcDto);
    profile.targets = targets;
    profile.aiRationale = rationale;

    await profile.save();
    await this.syncDailyTargets(userId, targets);

    return profile.toObject() as HealthProfileDocument;
  }

  /**
   * Update any fields of the active profile, recalculate targets,
   * clear stale monthly snapshots, and sync daily targets.
   */
  async updateProfile(
    userId: string,
    dto: UpdateHealthProfileDto,
  ): Promise<HealthProfileDocument> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) throw new NotFoundException('Health profile not found');

    // Apply field updates
    if (dto.gender !== undefined) profile.gender = dto.gender;
    if (dto.age !== undefined) profile.age = dto.age;
    if (dto.height !== undefined) profile.height = dto.height;
    if (dto.weight !== undefined) profile.weight = dto.weight;
    if (dto.bodyType !== undefined) profile.bodyType = dto.bodyType;
    if (dto.activityLevel !== undefined) profile.activityLevel = dto.activityLevel;
    if (dto.goal !== undefined) profile.goal = dto.goal;
    if (dto.targetWeightKg !== undefined) profile.targetWeightKg = dto.targetWeightKg;
    if (dto.healthCondition !== undefined) profile.healthCondition = dto.healthCondition as any;

    // Recalculate targets from updated profile
    const recalcDto: CreateHealthProfileDto = {
      gender: profile.gender,
      age: profile.age,
      height: profile.height as any,
      weight: profile.weight as any,
      bodyType: profile.bodyType,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
      targetWeightKg: profile.targetWeightKg,
      healthCondition: profile.healthCondition as any,
    };

    const { targets, rationale } = await this.generateTargets(recalcDto);
    profile.targets = targets;
    profile.aiRationale = rationale;

    // Rebuild timeline
    const tz = await this.getUserTz(userId);
    profile.timeline = this.buildTimeline(recalcDto, { targets, rationale }, tz);


    await this.dailyModel.deleteMany({
      userId: new Types.ObjectId(userId),
    }).exec();

    profile.monthlySnapshots = [];
    profile.markModified('monthlySnapshots');

    await profile.save();

    return profile.toObject() as HealthProfileDocument;
  }


  async updateDailyTargets(
    userId: string,
    date: string,
    dto: UpdateDailyTargetsDto,
  ): Promise<DailyIntakeDocument> {
    const setFields: Record<string, number> = {};
    if (dto.kcal !== undefined) setFields['targets.kcal'] = dto.kcal;
    if (dto.protein_g !== undefined) setFields['targets.protein_g'] = dto.protein_g;
    if (dto.carbs_g !== undefined) setFields['targets.carbs_g'] = dto.carbs_g;
    if (dto.fat_g !== undefined) setFields['targets.fat_g'] = dto.fat_g;
    if (dto.fiber_g !== undefined) setFields['targets.fiber_g'] = dto.fiber_g;
    if (dto.water_ml !== undefined) setFields['targets.water_ml'] = dto.water_ml;

    const daily = await this.dailyModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      {
        $set: setFields,
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          date,
          entries: [],
          totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        },
      },
      { new: true, upsert: true },
    ).exec();

    return daily as DailyIntakeDocument;
  }

  async resetDayEntries(userId: string, date: string): Promise<DailyIntakeDocument | null> {
    const daily = await this.dailyModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      {
        $set: {
          entries: [],
          totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        },
      },
      { new: true },
    ).exec();
    return daily;
  }

  
  async resetDailyRecommendation(userId: string, date: string): Promise<{ date: string; cleared: boolean }> {
    const result = await this.dailyModel.updateOne(
      { userId: new Types.ObjectId(userId), date },
      { $unset: { dailyRecommendation: 1 } },
    ).exec();
    return { date, cleared: result.modifiedCount > 0 };
  }


  async resetWaterIntake(userId: string, date: string): Promise<{ date: string; totalWater_ml: number }> {
    await this.dailyModel.updateOne(
      { userId: new Types.ObjectId(userId), date },
      { $set: { 'waterIntake.total_ml': 0, 'waterIntake.entries': [] } },
    ).exec();
    return { date, totalWater_ml: 0 };
  }

  async deleteWaterEntry(userId: string, date: string, index: number): Promise<{ date: string; totalWater_ml: number }> {
    const daily = await this.dailyModel
      .findOne({ userId: new Types.ObjectId(userId), date })
      .exec();
    if (!daily || !daily.waterIntake?.entries) {
      return { date, totalWater_ml: 0 };
    }

    const entries = daily.waterIntake.entries as any[];
    if (index < 0 || index >= entries.length) {
      throw new NotFoundException(`Water entry at index ${index} not found`);
    }

    const removedMl = entries[index]?.ml ?? 0;
    entries.splice(index, 1);
    daily.waterIntake.total_ml = Math.max(0, (daily.waterIntake.total_ml ?? 0) - removedMl);
    daily.markModified('waterIntake');
    await daily.save();

    return { date, totalWater_ml: daily.waterIntake.total_ml };
  }

  async resetMonthlySnapshotForMonth(userId: string, month: string): Promise<MonthlySnapshot> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) throw new NotFoundException('Health profile not found');

    const idx = profile.monthlySnapshots.findIndex(s => s.month === month);
    if (idx >= 0) {
      profile.monthlySnapshots[idx].cacheKey = '';
      profile.monthlySnapshots[idx].aiRecommendations = [];
      profile.markModified('monthlySnapshots');
      await profile.save();
    }

    return this.generateMonthlySnapshotForMonth(profile, month);
  }


  async resetAllSnapshots(userId: string): Promise<MonthlySnapshot[]> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) throw new NotFoundException('Health profile not found');

    for (const snap of profile.monthlySnapshots) {
      snap.cacheKey = '';
      snap.aiRecommendations = [];
    }
    profile.markModified('monthlySnapshots');
    await profile.save();

    return this.getMonthlyInsights(userId);
  }

  async logWater(userId: string, dto: LogWaterDto): Promise<{ date: string; totalWater_ml: number }> {
    const tz = await this.getUserTz(userId);
    const date = dto.date ?? localDateISO(tz);

    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .select('targets')
      .lean()
      .exec();

    const setOnInsertData: any = {
      userId: new Types.ObjectId(userId),
      date,
    };
    if (profile?.targets) {
      setOnInsertData.targets = {
        kcal: profile.targets.kcal,
        protein_g: profile.targets.protein_g,
        carbs_g: profile.targets.carbs_g,
        fat_g: profile.targets.fat_g,
        fiber_g: profile.targets.fiber_g ?? 0,
        water_ml: profile.targets.water_ml ?? 0,
      };
    }

    const daily = await this.dailyModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      {
        $inc: { 'waterIntake.total_ml': dto.ml },
        $push: {
          'waterIntake.entries': {
            ml: dto.ml,
            at: new Date(),
          },
        },
        $setOnInsert: setOnInsertData,
      },
      { new: true, upsert: true },
    ).exec();

    return {
      date,
      totalWater_ml: daily?.waterIntake?.total_ml ?? dto.ml,
    };
  }

  async getMonthlyInsights(userId: string): Promise<MonthlySnapshot[]> {
    const tz = await this.getUserTz(userId);
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) return [];

    const dailyDocs = await this.dailyModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('date entries totals waterIntake.total_ml')
      .lean()
      .exec();

    const monthsWithData = [...new Set(
      dailyDocs
        .filter(
          (d: any) =>
            (d.entries?.length ?? 0) > 0
            || (d.totals?.kcal ?? 0) > 0
            || (d.waterIntake?.total_ml ?? 0) > 0,
        )
        .map((d: any) => d.date.slice(0, 7)),
    )];

    const existingMonths = new Set(
      (profile.monthlySnapshots ?? []).map((s) => s.month),
    );

    const currentMonth = localMonthISO(tz);
    let didUpdate = false;
    for (const m of monthsWithData) {
      if (!existingMonths.has(m) || m === currentMonth) {
        const monthDailies = dailyDocs.filter((d: any) => d.date.startsWith(m));
        await this.generateMonthlySnapshotForMonth(profile, m, monthDailies);
        didUpdate = true;
      }
    }

    if (didUpdate) {
      await profile.save();
    }

    return profile.monthlySnapshots ?? [];
  }

  async generateMonthlySnapshot(userId: string, month?: string): Promise<MonthlySnapshot> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .exec();
    if (!profile) throw new NotFoundException('Health profile not found');

    const targetMonth = month ?? localMonthISO(await this.getUserTz(userId));

    const snapshot = await this.generateMonthlySnapshotForMonth(profile, targetMonth);
    await profile.save();
    return snapshot;
  }

  private async generateMonthlySnapshotForMonth(
    profile: HealthProfileDocument,
    month: string,
    prefetchedDailies?: any[],
  ): Promise<MonthlySnapshot> {
    const dailies = prefetchedDailies ?? await (async () => {
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const mon = parseInt(monthStr, 10);
      const startDate = `${month}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
      return this.dailyModel
        .find({
          userId: profile.userId,
          date: { $gte: startDate, $lte: endDate },
        })
        .select('date entries totals waterIntake.total_ml')
        .lean()
        .exec();
    })();

    const cacheKey = this.buildMonthlySnapshotCacheKey(profile, month, dailies);
    const existingSnapshot = (profile.monthlySnapshots ?? []).find(
      (snapshot) => snapshot.month === month,
    );

 
    const foodDays = dailies.filter(
      (d: any) => (d.entries?.length ?? 0) > 0 || (d.totals?.kcal ?? 0) > 0,
    );
    const waterDays = dailies.filter(
      (d: any) => (d.waterIntake?.total_ml ?? 0) > 0,
    );

    const daysWithFood = foodDays.length;
    const daysWithWater = waterDays.length;

    if (
      existingSnapshot?.cacheKey === cacheKey
      && (existingSnapshot.aiRecommendations?.length ?? 0) > 0
    ) {
      return existingSnapshot;
    }

    if (daysWithFood === 0 && daysWithWater === 0) {
      const snapshot: MonthlySnapshot = {
        month,
        avgDailyKcal: 0,
        avgProtein_g: 0,
        avgCarbs_g: 0,
        avgFat_g: 0,
        avgFiber_g: 0,
        avgWater_ml: 0,
        daysLogged: 0,
        daysOnTarget: 0,
        weightKg: profile.weight.kg,
        bmi: this.calculateBMI(profile.weight.kg, profile.height.cm),
        targetSnapshot: profile.targets ?? undefined,
        aiRecommendations: [],
        cacheKey,
        generatedAt: new Date(),
      };
      this.upsertSnapshotInMemory(profile, snapshot);
      return snapshot;
    }

    const sumKcal = foodDays.reduce((s, d: any) => s + (d.totals?.kcal ?? 0), 0);
    const sumProtein = foodDays.reduce((s, d: any) => s + (d.totals?.protein_g ?? 0), 0);
    const sumCarbs = foodDays.reduce((s, d: any) => s + (d.totals?.carbs_g ?? 0), 0);
    const sumFat = foodDays.reduce((s, d: any) => s + (d.totals?.fat_g ?? 0), 0);
    const sumFiber = foodDays.reduce((s, d: any) => s + (d.totals?.fiber_g ?? 0), 0);
    const sumWater = waterDays.reduce((s, d: any) => s + (d.waterIntake?.total_ml ?? 0), 0);

    const foodDivisor = daysWithFood || 1;
    const waterDivisor = daysWithWater || 1;

    const targetKcal = profile.targets?.kcal ?? 2000;
    const targetProtein = profile.targets?.protein_g ?? 0;
    const targetFat = profile.targets?.fat_g ?? 0;
    const tolerance = 0.15; 

    const daysOnTarget = foodDays.filter((d: any) => {
      const kcalOk = Math.abs((d.totals?.kcal ?? 0) - targetKcal) <= targetKcal * tolerance;
      if (targetProtein > 0 && targetFat > 0) {
        const proteinOk = Math.abs((d.totals?.protein_g ?? 0) - targetProtein) <= targetProtein * tolerance;
        const fatOk = Math.abs((d.totals?.fat_g ?? 0) - targetFat) <= targetFat * tolerance;
        return kcalOk && (proteinOk || fatOk);
      }
      return kcalOk;
    }).length;

    const snapshot: MonthlySnapshot = {
      month,
      avgDailyKcal: Math.round(sumKcal / foodDivisor),
      avgProtein_g: Math.round(sumProtein / foodDivisor),
      avgCarbs_g: Math.round(sumCarbs / foodDivisor),
      avgFat_g: Math.round(sumFat / foodDivisor),
      avgFiber_g: Math.round(sumFiber / foodDivisor),
      avgWater_ml: Math.round(sumWater / waterDivisor),
      daysLogged: daysWithFood, 
      daysOnTarget,
      weightKg: profile.weight.kg,
      bmi: this.calculateBMI(profile.weight.kg, profile.height.cm),
      targetSnapshot: profile.targets ?? undefined,
      aiRecommendations: [],
      cacheKey,
      generatedAt: new Date(),
    };

    snapshot.aiRecommendations = await this.generateSnapshotRecommendations(
      profile,
      snapshot,
    );

    this.upsertSnapshotInMemory(profile, snapshot);
    return snapshot;
  }

  async getDailyRecommendation(userId: string): Promise<{
    recommendations: string[];
    todaySummary: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number } | null;
    targets: NutritionTargets | null;
  }> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .lean<HealthProfileDocument>()
      .exec();
    if (!profile) return { recommendations: [], todaySummary: null, targets: null };

    const tz = await this.getUserTz(userId);
    const today = localDateISO(tz);

    const todayDoc = await this.dailyModel
      .findOne({ userId: new Types.ObjectId(userId), date: today })
      .lean()
      .exec();

    const todaySummary = todayDoc
      ? {
          kcal: (todayDoc as any).totals?.kcal ?? 0,
          protein_g: (todayDoc as any).totals?.protein_g ?? 0,
          carbs_g: (todayDoc as any).totals?.carbs_g ?? 0,
          fat_g: (todayDoc as any).totals?.fat_g ?? 0,
          water_ml: (todayDoc as any).waterIntake?.total_ml ?? 0,
        }
      : null;

    const weekAgo = new Date(`${today}T00:00:00.000Z`);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);

    const recentDays = await this.dailyModel
      .find({
        userId: new Types.ObjectId(userId),
        date: { $gte: weekAgoStr, $lte: today },
      })
      .select('date entries totals waterIntake.total_ml')
      .sort({ date: 1 })
      .lean()
      .exec();

    const foodDays = recentDays.filter(
      (d: any) => (d.entries?.length ?? 0) > 0 || (d.totals?.kcal ?? 0) > 0,
    );

    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const yesterdayDoc = await this.dailyModel
      .findOne({ userId: new Types.ObjectId(userId), date: yesterdayStr })
      .select('dailyRecommendation.recommendations')
      .lean()
      .exec();
    const previousRecommendations = (yesterdayDoc as any)?.dailyRecommendation?.recommendations ?? [];

    const cacheKey = this.buildDailyRecommendationCacheKey(
      profile.targets ?? null,
      todaySummary,
      recentDays,
    );
    const cachedRecommendations = (todayDoc as any)?.dailyRecommendation;
    if (
      cachedRecommendations?.cacheKey === cacheKey
      && Array.isArray(cachedRecommendations?.recommendations)
      && cachedRecommendations.recommendations.length > 0
    ) {
      return {
        recommendations: cachedRecommendations.recommendations,
        todaySummary,
        targets: profile.targets ?? null,
      };
    }

    const recommendations = await this.generateDailyAiRecommendations(
      profile,
      todaySummary,
      foodDays,
      today,
      previousRecommendations,
    );

    const setOnInsertData: any = {
      userId: new Types.ObjectId(userId),
      date: today,
      entries: [],
      totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
      waterIntake: { total_ml: 0, entries: [] },
    };
    if (profile.targets) {
      setOnInsertData.targets = {
        kcal: profile.targets.kcal,
        protein_g: profile.targets.protein_g,
        carbs_g: profile.targets.carbs_g,
        fat_g: profile.targets.fat_g,
        fiber_g: profile.targets.fiber_g ?? 0,
        water_ml: profile.targets.water_ml ?? 0,
      };
    }

    await this.dailyModel.updateOne(
      { userId: new Types.ObjectId(userId), date: today },
      {
        $set: {
          dailyRecommendation: {
            recommendations,
            cacheKey,
            generatedAt: new Date(),
          },
        },
        $setOnInsert: setOnInsertData,
      },
      { upsert: true },
    ).exec();

    return {
      recommendations,
      todaySummary,
      targets: profile.targets ?? null,
    };
  }

  private async generateSnapshotRecommendations(
    profile: HealthProfileDocument,
    snapshot: MonthlySnapshot,
  ): Promise<string[]> {
    if (!this.openai || snapshot.daysLogged === 0) {
      return this.buildFallbackRecommendations(profile, snapshot);
    }

    try {
      const targets = profile.targets;
      const goalText = this.goalDisplayText(profile.goal);
      const country = await this.getUserCountry(profile.userId.toString());
      const cuisine = getCuisineContext(country);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a certified nutritionist AI for Saveful, a global health tracking app.
Analyze the user's monthly performance data and provide 4-6 specific, actionable recommendations.

User's country: ${cuisine.countryName}
Cuisine context: ${cuisine.cuisineFocus} — use this as a soft preference for familiar foods, not a strict requirement (e.g., ${cuisine.exampleDishes}).
Cooking context: ${cuisine.cookingContext}

RULES:
1. Be specific — reference actual numbers (e.g., "You averaged 1400 kcal but your target is 1800").
2. Suggestions must be practical and should prefer familiar local ingredients without forcing a single cuisine style.
3. Keep each recommendation to 1-2 sentences max.
4. Focus on the biggest gaps first (calories, then protein, then water, then other macros).
5. If performance is good, acknowledge it and suggest optimization tips.
6. Consider the user's goal (weight loss/gain/maintain/health condition).

Respond ONLY with a JSON array of strings. No markdown, no explanation.`,
          },
          {
            role: 'user',
            content: `User Profile:
- Gender: ${profile.gender}, Age: ${profile.age}, Weight: ${profile.weight.kg}kg
- Goal: ${goalText}
- Activity: ${profile.activityLevel}
- Country: ${cuisine.countryName}

Daily Targets:
- Calories: ${targets?.kcal ?? 'N/A'} kcal
- Protein: ${targets?.protein_g ?? 'N/A'}g
- Carbs: ${targets?.carbs_g ?? 'N/A'}g
- Fat: ${targets?.fat_g ?? 'N/A'}g
- Water: ${targets?.water_ml ?? 'N/A'}ml

Monthly Performance (${snapshot.month}):
- Avg Daily Calories: ${snapshot.avgDailyKcal} kcal
- Avg Protein: ${snapshot.avgProtein_g}g
- Avg Carbs: ${snapshot.avgCarbs_g}g
- Avg Fat: ${snapshot.avgFat_g}g
- Avg Water: ${snapshot.avgWater_ml}ml
- Days Logged: ${snapshot.daysLogged}
- Days On Target: ${snapshot.daysOnTarget}
- BMI: ${snapshot.bmi ?? 'N/A'}

Return a JSON array of 4-6 recommendation strings.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 600,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty AI response');

      let clean = content.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) {
        return parsed.slice(0, 6);
      }
      throw new Error('Invalid AI format');
    } catch (err) {
      this.logger.error('AI snapshot recommendations failed, using fallback', err);
      return this.buildFallbackRecommendations(profile, snapshot);
    }
  }

  private async generateDailyAiRecommendations(
    profile: HealthProfileDocument,
    todaySummary: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number } | null,
    recentDays: any[],
    todayIso: string,
    previousRecommendations: string[] = [],
  ): Promise<string[]> {
    const targets = profile.targets;
    if (!targets) return ['Set up your health profile targets to get personalized recommendations.'];

    const foodDays = recentDays.filter(
      (d: any) => (d.entries?.length ?? 0) > 0 || (d.totals?.kcal ?? 0) > 0,
    );
    const n = foodDays.length || 1;
    const waterDaysCount = recentDays.filter((d: any) => (d.waterIntake?.total_ml ?? 0) > 0).length || 1;
    const avg = {
      kcal: Math.round(foodDays.reduce((s, d: any) => s + (d.totals?.kcal ?? 0), 0) / n),
      protein_g: Math.round(foodDays.reduce((s, d: any) => s + (d.totals?.protein_g ?? 0), 0) / n),
      carbs_g: Math.round(foodDays.reduce((s, d: any) => s + (d.totals?.carbs_g ?? 0), 0) / n),
      fat_g: Math.round(foodDays.reduce((s, d: any) => s + (d.totals?.fat_g ?? 0), 0) / n),
      water_ml: Math.round(recentDays.reduce((s, d: any) => s + (d.waterIntake?.total_ml ?? 0), 0) / waterDaysCount),
    };

    if (!this.openai) {
      return this.buildFallbackDailyRecommendations(targets, todaySummary, avg, todayIso);
    }

    try {
      const goalText = this.goalDisplayText(profile.goal);
      const country = await this.getUserCountry(profile.userId.toString());
      const cuisine = getCuisineContext(country);
      const todayText = todaySummary
        ? `Today's intake so far: ${todaySummary.kcal} kcal, ${todaySummary.protein_g}g protein, ${todaySummary.carbs_g}g carbs, ${todaySummary.fat_g}g fat, ${todaySummary.water_ml}ml water`
        : 'No meals logged yet today';
      const previousText = previousRecommendations.length > 0
        ? `Yesterday's recommendations were: ${previousRecommendations.join(' | ')}`
        : 'No previous-day recommendations available';

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a certified nutritionist AI for Saveful, a global health tracking app.
Give 3-5 specific daily recommendations based on today's intake and recent trends.

User's country: ${cuisine.countryName}
Cuisine context: ${cuisine.cuisineFocus} — suggest foods the user is likely familiar with (e.g., ${cuisine.exampleDishes}).
Cooking context: ${cuisine.cookingContext}

RULES:
1. If the user has eaten today, suggest what to eat for remaining meals to hit targets.
2. If the user hasn't eaten yet, suggest a meal plan for the day.
3. Prefer foods that are practical and familiar for someone in ${cuisine.countryName}, but do not force a single cuisine style into every recommendation.
4. Be encouraging and practical.
5. Keep each recommendation to 1-2 sentences.
6. Consider the 7-day trend — if they've been consistently over/under, address that.
7. Avoid repeating yesterday's exact recommendation wording when possible; keep the advice fresh for the new day.

Respond ONLY with a JSON array of strings.`,
          },
          {
            role: 'user',
            content: `User: ${profile.gender}, ${profile.age}y, ${profile.weight.kg}kg, Goal: ${goalText}, Country: ${cuisine.countryName}

Date: ${todayIso}

Daily Targets: ${targets.kcal} kcal, ${targets.protein_g}g protein, ${targets.carbs_g}g carbs, ${targets.fat_g}g fat, ${targets.water_ml}ml water

${todayText}

7-day averages: ${avg.kcal} kcal, ${avg.protein_g}g protein, ${avg.carbs_g}g carbs, ${avg.fat_g}g fat, ${avg.water_ml}ml water (${foodDays.length} days with food in last 7 days)

${previousText}

Return a JSON array of 3-5 recommendation strings.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty AI response');

      let clean = content.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) {
        return parsed.slice(0, 5);
      }
      throw new Error('Invalid AI format');
    } catch (err) {
      this.logger.error('AI daily recommendations failed, using fallback', err);
      return this.buildFallbackDailyRecommendations(targets, todaySummary, avg, todayIso);
    }
  }

  private buildFallbackRecommendations(
    profile: HealthProfileDocument,
    snapshot: MonthlySnapshot,
  ): string[] {
    const tips: string[] = [];
    const targets = profile.targets;
    if (!targets) return ['Complete your health profile to get personalized tips.'];

    const kcalDiff = snapshot.avgDailyKcal - targets.kcal;
    if (kcalDiff > targets.kcal * 0.15) {
      tips.push(
        `You averaged ${snapshot.avgDailyKcal} kcal/day vs your ${targets.kcal} kcal target. Try reducing portion sizes or switching to lower-calorie options.`,
      );
    } else if (kcalDiff < -(targets.kcal * 0.15)) {
      tips.push(
        `You averaged only ${snapshot.avgDailyKcal} kcal/day — ${Math.abs(kcalDiff)} under your ${targets.kcal} kcal target. Undereating can slow metabolism.`,
      );
    }
    if (snapshot.avgProtein_g < targets.protein_g * 0.85) {
      tips.push(
        `Protein was ${snapshot.avgProtein_g}g avg vs ${targets.protein_g}g target. Add eggs, paneer, dal, or chicken to boost it.`,
      );
    }
    if (snapshot.avgWater_ml < targets.water_ml * 0.7) {
      tips.push(
        `Water intake averaged ${Math.round(snapshot.avgWater_ml)}ml — well below your ${targets.water_ml}ml goal. Keep a bottle nearby.`,
      );
    }
    if (snapshot.daysLogged < 15) {
      tips.push(
        `Only ${snapshot.daysLogged} days logged this month. Consistent logging helps you stay on track.`,
      );
    }
    if (snapshot.daysLogged > 0) {
      const adherence = Math.round((snapshot.daysOnTarget / snapshot.daysLogged) * 100);
      if (adherence >= 70) {
        tips.push(`Excellent ${adherence}% adherence! Keep up the consistency.`);
      } else if (adherence < 40) {
        tips.push(`Your adherence was ${adherence}%. Focus on meal prep and planning ahead.`);
      }
    }
    if (tips.length === 0) {
      tips.push("You're doing well! Stay consistent with your meal tracking.");
    }
    return tips;
  }

  private buildFallbackDailyRecommendations(
    targets: NutritionTargets,
    todaySummary: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number } | null,
    weekAvg: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number },
    todayIso?: string,
  ): string[] {
    const tips: string[] = [];
    const dayOfMonth = todayIso ? parseInt(todayIso.slice(8, 10), 10) : 1;
    const rotation = dayOfMonth % 3;

    if (!todaySummary || todaySummary.kcal === 0) {
      const breakfastVariants = [
        `Start your day with a balanced breakfast targeting ~${Math.round(targets.kcal * 0.3)} kcal.`,
        `Plan an early balanced breakfast around ${Math.round(targets.kcal * 0.3)} kcal so the rest of the day stays easier to manage.`,
        `Open the day with a structured breakfast near ${Math.round(targets.kcal * 0.3)} kcal to avoid overeating later.`,
      ];
      tips.push(breakfastVariants[rotation]);
      if (weekAvg.protein_g < targets.protein_g * 0.85) {
        tips.push(`Your protein has been low this week (${weekAvg.protein_g}g avg vs ${targets.protein_g}g target). Include protein-rich foods like dal, paneer, or eggs in every meal.`);
      }
    } else {
      const remaining = targets.kcal - todaySummary.kcal;
      if (remaining > 300) {
        tips.push(`You have ${Math.round(remaining)} kcal remaining today. Plan your next meal accordingly.`);
      } else if (remaining < -100) {
        tips.push(`You've exceeded your calorie target by ${Math.round(Math.abs(remaining))} kcal. Keep your remaining meals light.`);
      }
      const proteinLeft = targets.protein_g - todaySummary.protein_g;
      if (proteinLeft > 20) {
        tips.push(`You still need ~${Math.round(proteinLeft)}g protein today. Consider dal, curd, or grilled chicken.`);
      }
      const waterLeft = targets.water_ml - todaySummary.water_ml;
      if (waterLeft > 500) {
        tips.push(`Drink ${Math.round(waterLeft / 250)} more glasses of water today.`);
      }
    }

    if (tips.length === 0) {
      tips.push("You're on track today! Keep logging your meals to stay consistent.");
    }
    return tips;
  }

  private goalDisplayText(goal: GoalType): string {
    switch (goal) {
      case GoalType.LOSE_WEIGHT: return 'Lose Weight';
      case GoalType.GAIN_WEIGHT: return 'Gain Weight';
      case GoalType.HEALTH_CONDITION: return 'Health Condition Management';
      default: return 'Maintain Weight';
    }
  }

  private buildDailyRecommendationCacheKey(
    targets: NutritionTargets | null | undefined,
    todaySummary: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number } | null,
    recentDays: any[],
  ): string {
    const b = (v: number, step: number) => Math.round(v / step) * step;
    const targetKey = targets
      ? [
          targets.kcal,
          targets.protein_g,
          targets.carbs_g,
          targets.fat_g,
          targets.fiber_g,
          targets.water_ml,
        ].join(':')
      : 'no-targets';
    const todayKey = todaySummary
      ? [
          b(todaySummary.kcal, 50),
          b(todaySummary.protein_g, 5),
          b(todaySummary.carbs_g, 5),
          b(todaySummary.fat_g, 5),
          b(todaySummary.water_ml, 100),
        ].join(':')
      : 'no-today';
    const historyKey = recentDays
      .map(
        (day: any) => [
          day.date,
          b(day.totals?.kcal ?? 0, 50),
          b(day.totals?.protein_g ?? 0, 5),
          b(day.totals?.carbs_g ?? 0, 5),
          b(day.totals?.fat_g ?? 0, 5),
          b(day.waterIntake?.total_ml ?? 0, 100),
        ].join(':'),
      )
      .join('|');

    const raw = `${targetKey}::${todayKey}::${historyKey}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  private buildMonthlySnapshotCacheKey(
    profile: HealthProfileDocument,
    month: string,
    dailies: any[],
  ): string {
    const targetKey = profile.targets
      ? [
          profile.targets.kcal,
          profile.targets.protein_g,
          profile.targets.carbs_g,
          profile.targets.fat_g,
          profile.targets.fiber_g,
          profile.targets.water_ml,
        ].join(':')
      : 'no-targets';
    const dailyKey = dailies
      .map(
        (day: any) => [
          day.date,
          day.totals?.kcal ?? 0,
          day.totals?.protein_g ?? 0,
          day.totals?.carbs_g ?? 0,
          day.totals?.fat_g ?? 0,
          day.totals?.fiber_g ?? 0,
          day.waterIntake?.total_ml ?? 0,
          day.entries?.length ?? 0,
        ].join(':'),
      )
      .join('|');

    const raw = [
      month,
      profile.goal,
      profile.activityLevel,
      profile.weight?.kg ?? 0,
      targetKey,
      dailyKey,
    ].join('::');
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  private async generateTargets(
    dto: CreateHealthProfileDto,
  ): Promise<{ targets: NutritionTargets; rationale: string }> {
    if (this.openai) {
      try {
        return await this.generateTargetsWithAI(dto);
      } catch (err) {
        this.logger.error('AI target generation failed, falling back to formula', err);
      }
    }
    return this.generateTargetsWithFormula(dto);
  }

  private async generateTargetsWithAI(
    dto: CreateHealthProfileDto,
  ): Promise<{ targets: NutritionTargets; rationale: string }> {
    const conditionsText =
      dto.healthCondition?.conditions?.length
        ? `Health conditions: ${dto.healthCondition.conditions.join(', ')}`
        : 'No specific health conditions';
    const doctorText = dto.healthCondition?.doctorRecommendation
      ? `Doctor's recommendation: ${dto.healthCondition.doctorRecommendation}`
      : '';
    const goalText =
      dto.goal === GoalType.LOSE_WEIGHT
        ? `Lose weight. Target weight: ${dto.targetWeightKg ?? 'not specified'} kg.`
        : dto.goal === GoalType.GAIN_WEIGHT
          ? `Gain weight. Target weight: ${dto.targetWeightKg ?? 'not specified'} kg.`
          : dto.goal === GoalType.HEALTH_CONDITION
            ? 'Maintain diet specific to health condition.'
            : 'Maintain current weight and health.';

    const response = await this.openai!.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are a certified nutritionist AI for Saveful, a global health & food tracking app.
Given a user's health profile, calculate precise daily nutrition targets.

RULES:
1. Use Mifflin-St Jeor equation for BMR, then apply activity factor.
2. For weight loss: Create a safe deficit (500-750 kcal/day max), never below 1200 for women or 1500 for men.
3. For weight gain: Create a surplus of 300-500 kcal/day.
4. For health conditions: Adjust macros appropriately (e.g., diabetes = lower carbs, kidney disease = lower protein).
5. Account for body type: ectomorphs need more carbs, endomorphs need moderate carbs.
6. Water: 35ml per kg of body weight base, adjust for activity.
7. Provide realistic timeline for weight goals (0.3-0.7 kg/week loss is safe).
8. All values should be realistic and evidence-based.

Respond ONLY with valid JSON, no markdown.`,
        },
        {
          role: 'user',
          content: `Profile:
- Gender: ${dto.gender}
- Age: ${dto.age} years
- Height: ${dto.height.cm} cm
- Weight: ${dto.weight.kg} kg
- Body type: ${dto.bodyType}
- Activity level: ${dto.activityLevel ?? 'moderate'}
- Goal: ${goalText}
- ${conditionsText}
${doctorText ? `- ${doctorText}` : ''}

Return JSON:
{
  "kcal": 1800,
  "protein_g": 90,
  "carbs_g": 200,
  "fat_g": 60,
  "fiber_g": 30,
  "water_ml": 2500,
  "estimatedWeeks": 16,
  "weeklyChangeKg": 0.5,
  "targetDate": "2026-08-01",
  "rationale": "Based on Mifflin-St Jeor equation... (2-3 sentences explanation)"
}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('AI returned empty');

    let clean = content.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed: AiGoalResponse = JSON.parse(clean);

    const targets: NutritionTargets = {
      kcal: clamp(parsed.kcal, 1000, 5000),
      protein_g: clamp(parsed.protein_g, 30, 400),
      carbs_g: clamp(parsed.carbs_g, 50, 600),
      fat_g: clamp(parsed.fat_g, 20, 250),
      fiber_g: clamp(parsed.fiber_g, 15, 80),
      water_ml: clamp(parsed.water_ml, 1000, 6000),
    };

    return {
      targets,
      rationale: parsed.rationale || 'AI-generated personalized targets based on your profile.',
    };
  }

  private generateTargetsWithFormula(
    dto: CreateHealthProfileDto,
  ): { targets: NutritionTargets; rationale: string } {
    const weight = dto.weight.kg;
    const height = dto.height.cm;
    const age = dto.age;

    let bmr: number;
    if (dto.gender === Gender.MALE) {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else if (dto.gender === Gender.FEMALE) {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    } else {
      // Gender.OTHER: average of male and female Mifflin-St Jeor formulas
      const maleBmr = 10 * weight + 6.25 * height - 5 * age + 5;
      const femaleBmr = 10 * weight + 6.25 * height - 5 * age - 161;
      bmr = (maleBmr + femaleBmr) / 2;
    }

    const activityMultipliers: Record<ActivityLevel, number> = {
      [ActivityLevel.SEDENTARY]: 1.2,
      [ActivityLevel.LIGHT]: 1.375,
      [ActivityLevel.MODERATE]: 1.55,
      [ActivityLevel.ACTIVE]: 1.725,
      [ActivityLevel.VERY_ACTIVE]: 1.9,
    };
    const activity = dto.activityLevel ?? ActivityLevel.MODERATE;
    let tdee = bmr * activityMultipliers[activity];

    let weeklyChangeKg = 0;
    if (dto.goal === GoalType.LOSE_WEIGHT) {
      tdee -= 500; 
      weeklyChangeKg = -0.45;
      const minKcal = dto.gender === Gender.MALE ? 1500 : 1200;
      tdee = Math.max(tdee, minKcal);
    } else if (dto.goal === GoalType.GAIN_WEIGHT) {
      tdee += 400;
      weeklyChangeKg = 0.35;
    }

    let carbPct: number, fatPct: number, proteinPct: number;
    switch (dto.bodyType) {
      case BodyType.ECTOMORPH:
        carbPct = 0.50; proteinPct = 0.25; fatPct = 0.25;
        break;
      case BodyType.ENDOMORPH:
        carbPct = 0.35; proteinPct = 0.35; fatPct = 0.30;
        break;
      default:
        carbPct = 0.40; proteinPct = 0.30; fatPct = 0.30;
    }

    const conditions = dto.healthCondition?.conditions?.map(c => c.toLowerCase()) ?? [];
    if (conditions.some(c => c.includes('diabetes'))) {
      carbPct = Math.max(carbPct - 0.10, 0.25);
      proteinPct += 0.05;
      fatPct += 0.05;
    }
    if (conditions.some(c => c.includes('kidney'))) {
      proteinPct = Math.min(proteinPct, 0.15);
      carbPct += 0.10;
    }

    const pctSum = carbPct + proteinPct + fatPct;
    if (pctSum > 0 && Math.abs(pctSum - 1.0) > 0.001) {
      carbPct /= pctSum;
      proteinPct /= pctSum;
      fatPct /= pctSum;
    }

    const kcal = Math.round(tdee);
    const protein_g = Math.round((kcal * proteinPct) / 4);
    const carbs_g = Math.round((kcal * carbPct) / 4);
    const fat_g = Math.round((kcal * fatPct) / 9);
    const fiber_g = dto.gender === Gender.MALE ? 38 : 25;
    const water_ml = Math.round(weight * 35);

    const targets: NutritionTargets = {
      kcal,
      protein_g,
      carbs_g,
      fat_g,
      fiber_g,
      water_ml: clamp(water_ml, 1500, 5000),
    };

    const rationale = `Calculated using Mifflin-St Jeor equation. Your BMR is ~${Math.round(bmr)} kcal. With ${activity} activity, your TDEE is ~${Math.round(bmr * activityMultipliers[activity])} kcal. ${dto.goal === GoalType.LOSE_WEIGHT ? 'A 500 kcal deficit has been applied for safe weight loss.' : dto.goal === GoalType.GAIN_WEIGHT ? 'A 400 kcal surplus has been applied for gradual weight gain.' : 'Targets are set to maintain your current weight.'}`;

    return { targets, rationale };
  }

  private buildTimeline(
    dto: CreateHealthProfileDto,
    result: { targets: NutritionTargets; rationale: string },
    tz: string = 'UTC',
  ): GoalTimeline {
    if (dto.goal !== GoalType.LOSE_WEIGHT && dto.goal !== GoalType.GAIN_WEIGHT) {
      return {};
    }

    const currentKg = dto.weight.kg;
    const targetKg = dto.targetWeightKg ?? currentKg;
    const diff = Math.abs(targetKg - currentKg);

    const rate = dto.goal === GoalType.LOSE_WEIGHT ? 0.45 : 0.35;
    const weeks = Math.max(1, Math.ceil(diff / rate));
    const startDate = localDateISO(tz);
    const targetDateObj = new Date(startDate);
    targetDateObj.setDate(targetDateObj.getDate() + weeks * 7);
    const targetDate = targetDateObj.toISOString().slice(0, 10);

    return {
      targetWeightKg: targetKg,
      startWeightKg: currentKg,
      estimatedWeeks: weeks,
      weeklyChangeKg: dto.goal === GoalType.LOSE_WEIGHT ? -rate : rate,
      startDate,
      targetDate,
    };
  }

  private async syncDailyTargets(
    userId: string,
    targets: NutritionTargets,
  ): Promise<void> {
    const tz = await this.getUserTz(userId);
    const today = localDateISO(tz);
    await this.dailyModel.updateOne(
      { userId: new Types.ObjectId(userId), date: today },
      {
        $set: {
          targets: {
            kcal: targets.kcal,
            protein_g: targets.protein_g,
            carbs_g: targets.carbs_g,
            fat_g: targets.fat_g,
            fiber_g: targets.fiber_g,
            water_ml: targets.water_ml,
          },
        },
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          date: today,
          entries: [],
          totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        },
      },
      { upsert: true },
    );
  }

  private async upsertSnapshot(
    profile: HealthProfileDocument,
    snapshot: MonthlySnapshot,
  ): Promise<void> {
    this.upsertSnapshotInMemory(profile, snapshot);
    await profile.save();
  }

  private upsertSnapshotInMemory(
    profile: HealthProfileDocument,
    snapshot: MonthlySnapshot,
  ): void {
    const idx = profile.monthlySnapshots.findIndex(
      (s) => s.month === snapshot.month,
    );
    if (idx >= 0) {
      profile.monthlySnapshots[idx] = snapshot;
    } else {
      profile.monthlySnapshots.push(snapshot);
    }
    profile.markModified('monthlySnapshots');
  }

  private calculateBMI(weightKg: number, heightCm: number): number {
    const heightM = heightCm / 100;
    return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
