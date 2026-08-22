import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TrackSurvey, TrackSurveyDocument } from 'src/database/schemas/track-survey.schema';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';
import { CreateTrackSurveyDto } from './dto/create-track-survey.dto';
import {
  SurveyEligibilityDto,
  TrackSurveyResponseDto,
  WeeklySavingsSummaryDto,
} from './dto/track-survey-response.dto';
import { QantasService } from '../qantas/qantas.service';
import { SurveyConfigService } from '../survey-config/survey-config.service';
import { SurveyConfigDocument } from 'src/database/schemas/survey-config.schema';
import {
  moneySavedFromFoodGrams,
  resolveCurrencySymbol,
} from '../analytics/utils/impact-pricing.util';

@Injectable()
export class TrackSurveyService {
  private readonly logger = new Logger(TrackSurveyService.name);
  private readonly surveyIntervalMs = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel(TrackSurvey.name)
    private trackSurveyModel: Model<TrackSurveyDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @Inject(forwardRef(() => QantasService))
    private readonly qantasService: QantasService,
    private readonly surveyConfigService: SurveyConfigService,
  ) {}

  private normalizeSurveyDay(
    surveyDay?: number | null,
    fallbackDate?: Date | string,
  ): number {
    if (typeof surveyDay === 'number' && surveyDay >= 0 && surveyDay <= 6) {
      return surveyDay;
    }

    if (fallbackDate) {
      const parsedFallback = new Date(fallbackDate);
      if (!Number.isNaN(parsedFallback.getTime())) {
        return parsedFallback.getDay();
      }
    }

    return new Date().getDay();
  }

  private getWeekStart(surveyDay: number): Date {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = (dayOfWeek - surveyDay + 7) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  private getNextSurveyDateFromCompletion(completedAt: Date | string): Date {
    const completed = new Date(completedAt);
    if (Number.isNaN(completed.getTime())) {
      return new Date(Date.now() + this.surveyIntervalMs);
    }

    return new Date(completed.getTime() + this.surveyIntervalMs);
  }

  private calculateSavingsWithConfig(
    dto: CreateTrackSurveyDto,
    config: SurveyConfigDocument,
  ) {
    if (!dto.country) {
      throw new BadRequestException('User has no country set — please complete onboarding');
    }

    const { co2PerGram, avgWeeklyWasteGrams, scrapsWeightPerUnit, leftoversWeightPerUnit } =
      config.calculationConstants;

    const scrapsWeight = dto.scraps * scrapsWeightPerUnit;
    const leftoversWeight = dto.uneatenLeftovers * leftoversWeightPerUnit;

    const activeCategories = config.produceWasteCategories.filter((c) => c.isActive);
    let produceWeight = 0;
    for (const cat of activeCategories) {
      const qty = dto.produceWaste?.[cat.key] ?? 0;
      produceWeight += qty * cat.weightPerUnit;
    }

    const totalWasteGrams = scrapsWeight + leftoversWeight + produceWeight;
    const foodSaved = Math.max(0, avgWeeklyWasteGrams - totalWasteGrams);

    const co2_savings = Math.round(foodSaved * co2PerGram);
    // Same country-rate lookup as track money saved, so "Australia" and "AU"
    // both resolve to AUD instead of falling back to India/₹.
    const cost_savings = moneySavedFromFoodGrams(
      foodSaved,
      dto.country,
      config.countryRates,
    );

    return {
      co2_savings,
      cost_savings,
      food_saved: Math.round(foodSaved),
      currency_symbol: resolveCurrencySymbol(dto.country, config.countryRates),
    };
  }

  private overlayCurrencySymbol(
    savings: {
      co2_savings: number;
      cost_savings: number;
      food_saved: number;
      currency_symbol: string;
    } | undefined,
    country: string | undefined,
    config: SurveyConfigDocument,
  ) {
    if (!savings) return savings;
    if (!country) return savings;
    return {
      ...savings,
      currency_symbol: resolveCurrencySymbol(country, config.countryRates),
    };
  }

  async checkEligibility(userId: string): Promise<SurveyEligibilityDto> {
    const userIdObj = new Types.ObjectId(userId);
    const config = await this.surveyConfigService.getActiveConfig();
    const uiCfg = config.uiConfig;

    const lastSurvey = await this.trackSurveyModel
      .findOne({ userId: userIdObj })
      .sort({ completedAt: -1, surveyWeek: -1 })
      .lean();

    const totalSurveys = await this.trackSurveyModel.countDocuments({
      userId: userIdObj,
    });

    if (!lastSurvey) {
      return {
        eligible: true,
        next_survey_date: null,
        last_survey_date: null,
        surveys_count: 0,
        message: uiCfg?.eligibilityMessage || 'Ready to take your first survey!',
      };
    }

    const lastCompletedAt = lastSurvey.completedAt ?? lastSurvey.createdAt ?? lastSurvey.surveyWeek;
    const nextSurveyDate = this.getNextSurveyDateFromCompletion(lastCompletedAt);
    const eligible = Date.now() >= nextSurveyDate.getTime();

    return {
      eligible,
      next_survey_date: nextSurveyDate.toISOString(),
      last_survey_date: new Date(lastCompletedAt).toISOString(),
      surveys_count: totalSurveys,
      message: eligible
        ? (uiCfg?.eligibilityMessage || 'Ready to take this week\'s survey!')
        : (uiCfg?.notEligibleMessage || 'Your next survey is not due yet'),
    };
  }

  async createSurvey(
    userId: string,
    dto: CreateTrackSurveyDto,
  ): Promise<TrackSurveyResponseDto> {
    const userIdObj = new Types.ObjectId(userId);

    const latestSurvey = await this.trackSurveyModel
      .findOne({ userId: userIdObj })
      .sort({ completedAt: -1, surveyWeek: -1 })
      .lean();

    const surveyDay = this.normalizeSurveyDay(
      dto.surveyDay ?? latestSurvey?.surveyDay,
      latestSurvey?.surveyWeek,
    );
    const weekStart = this.getWeekStart(surveyDay);

    const eligibility = await this.checkEligibility(userId);
    if (!eligibility.eligible) {
      throw new BadRequestException(
        'You have already completed a survey for this week',
      );
    }

    const existingSurvey = await this.trackSurveyModel.findOne({
      userId: userIdObj,
      surveyWeek: weekStart,
    });

    if (existingSurvey) {
      throw new BadRequestException('Survey already exists for this week');
    }

    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new BadRequestException('User not found');
    if (!user.country) throw new BadRequestException('User has no country set — please complete onboarding');
    dto.country = user.country;

    const config = await this.surveyConfigService.getActiveConfig();
    const calculatedSavings = this.calculateSavingsWithConfig(dto, config);

    const isBaseline = eligibility.surveys_count === 0;

    const personalBests = await this.getPersonalBests(userId);

    const survey = new this.trackSurveyModel({
      userId: userIdObj,
      cookingFrequency: dto.cookingFrequency,
      scraps: dto.scraps,
      uneatenLeftovers: dto.uneatenLeftovers,
      produceWaste: dto.produceWaste,
      preferredIngredients: dto.preferredIngredients,
      noOfCooks: dto.noOfCooks ?? 1,
      calculatedSavings,
      isBaseline,
      surveyWeek: weekStart,
      surveyDay,
      isCo2PersonalBest: calculatedSavings.co2_savings > personalBests.co2_savings,
      isCostPersonalBest: calculatedSavings.cost_savings > personalBests.cost_savings,
      isFoodSavedPersonalBest: calculatedSavings.food_saved > personalBests.food_saved,
    });

    const saved = await survey.save();

    try {
      await this.qantasService.onSurveyCompleted(userId, saved._id.toString());
    } catch (error) {
      this.logger.error(`Qantas onSurveyCompleted failed for user ${userId}`, error);
    }

    const dto_response = this.toResponseDto(saved);
    dto_response.calculatedSavings = this.overlayCurrencySymbol(
      dto_response.calculatedSavings,
      user.country,
      config,
    )!;
    dto_response.prev_personal_bests = personalBests;

    const weekNumber = (eligibility.surveys_count % (config.weeklyTips?.length || 1)) + 1;
    const tip = config.weeklyTips?.find(
      (t) => t.weekNumber === weekNumber && t.isActive,
    );
    if (tip) {
      dto_response.weeklyTip = {
        title: tip.title,
        content: tip.content,
        imageUrl: tip.imageUrl || '',
      };
    }

    return dto_response;
  }

  async getUserSurveys(userId: string): Promise<TrackSurveyResponseDto[]> {
    const userIdObj = new Types.ObjectId(userId);

    const [surveys, user, config] = await Promise.all([
      this.trackSurveyModel
        .find({ userId: userIdObj })
        .sort({ surveyWeek: -1 })
        .lean(),
      this.userModel.findById(userId).select('country').lean(),
      this.surveyConfigService.getActiveConfig(),
    ]);

    return surveys.map((s) => {
      const dto = this.toResponseDto(s);
      dto.calculatedSavings = this.overlayCurrencySymbol(
        dto.calculatedSavings,
        user?.country,
        config,
      )!;
      return dto;
    });
  }

  async getLatestSurvey(userId: string): Promise<TrackSurveyResponseDto> {
    const userIdObj = new Types.ObjectId(userId);

    const [survey, user, config] = await Promise.all([
      this.trackSurveyModel
        .findOne({ userId: userIdObj })
        .sort({ surveyWeek: -1 })
        .lean(),
      this.userModel.findById(userId).select('country').lean(),
      this.surveyConfigService.getActiveConfig(),
    ]);

    if (!survey) {
      throw new NotFoundException('No surveys found for this user');
    }

    const dto = this.toResponseDto(survey);
    dto.calculatedSavings = this.overlayCurrencySymbol(
      dto.calculatedSavings,
      user?.country,
      config,
    )!;
    return dto;
  }

  private async getPersonalBests(userId: string) {
    const userIdObj = new Types.ObjectId(userId);

    const surveys = await this.trackSurveyModel
      .find({ userId: userIdObj })
      .lean();

    if (surveys.length === 0) {
      return { co2_savings: 0, cost_savings: 0, food_saved: 0 };
    }

    return {
      co2_savings: Math.max(
        ...surveys.map((s) => s.calculatedSavings.co2_savings),
      ),
      cost_savings: Math.max(
        ...surveys.map((s) => s.calculatedSavings.cost_savings),
      ),
      food_saved: Math.max(
        ...surveys.map((s) => s.calculatedSavings.food_saved),
      ),
    };
  }

  async getWeeklySummary(userId: string): Promise<WeeklySavingsSummaryDto> {
    const userIdObj = new Types.ObjectId(userId);

    const surveys = await this.trackSurveyModel
      .find({ userId: userIdObj })
      .sort({ surveyWeek: -1 })
      .limit(2)
      .lean();

    if (surveys.length === 0) {
      throw new NotFoundException('No surveys found');
    }

    const [personalBests, allSurveys, user, config] = await Promise.all([
      this.getPersonalBests(userId),
      this.trackSurveyModel.find({ userId: userIdObj }).lean(),
      this.userModel.findById(userId).select('country').lean(),
      this.surveyConfigService.getActiveConfig(),
    ]);

    const totalSavings = allSurveys.reduce(
      (acc, survey) => ({
        co2: acc.co2 + survey.calculatedSavings.co2_savings,
        cost: acc.cost + survey.calculatedSavings.cost_savings,
        food: acc.food + survey.calculatedSavings.food_saved,
      }),
      { co2: 0, cost: 0, food: 0 },
    );

    const currencySymbol = user?.country
      ? resolveCurrencySymbol(user.country, config.countryRates)
      : surveys[0].calculatedSavings.currency_symbol;

    return {
      current_week: this.overlayCurrencySymbol(
        surveys[0].calculatedSavings,
        user?.country,
        config,
      )!,
      previous_week: surveys[1]
        ? this.overlayCurrencySymbol(
            surveys[1].calculatedSavings,
            user?.country,
            config,
          )!
        : null,
      personal_bests: {
        ...personalBests,
        currency_symbol: currencySymbol,
      },
      total_surveys: allSurveys.length,
      total_co2_saved: totalSavings.co2,
      total_cost_saved: totalSavings.cost,
      total_food_saved: totalSavings.food,
    };
  }

  private toResponseDto(doc: any): TrackSurveyResponseDto {
    return {
      _id: doc._id.toString(),
      userId: doc.userId.toString(),
      cookingFrequency: doc.cookingFrequency,
      scraps: doc.scraps,
      uneatenLeftovers: doc.uneatenLeftovers,
      produceWaste: doc.produceWaste,
      preferredIngredients: doc.preferredIngredients,
      noOfCooks: doc.noOfCooks,
      calculatedSavings: doc.calculatedSavings,
      isBaseline: doc.isBaseline,
      surveyWeek: doc.surveyWeek,
      surveyDay: doc.surveyDay,
      isCo2PersonalBest: doc.isCo2PersonalBest,
      isCostPersonalBest: doc.isCostPersonalBest,
      isFoodSavedPersonalBest: doc.isFoodSavedPersonalBest,
      completedAt: doc.completedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
