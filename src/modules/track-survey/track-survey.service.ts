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

@Injectable()
export class TrackSurveyService {
  private readonly logger = new Logger(TrackSurveyService.name);

  constructor(
    @InjectModel(TrackSurvey.name)
    private trackSurveyModel: Model<TrackSurveyDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @Inject(forwardRef(() => QantasService))
    private readonly qantasService: QantasService,
    private readonly surveyConfigService: SurveyConfigService,
  ) {}

  private getWeekStart(surveyDay: number): Date {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = (dayOfWeek - surveyDay + 7) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  private getNextSurveyDate(lastSurveyWeek: Date, surveyDay: number): Date {
    const nextWeek = new Date(lastSurveyWeek);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }

  private calculateSavingsWithConfig(
    dto: CreateTrackSurveyDto,
    config: SurveyConfigDocument,
  ) {
    if (!dto.country) {
      throw new BadRequestException('User has no country set — please complete onboarding');
    }

    let countryRate = config.countryRates.find(
      (r) => r.countryCode === dto.country && r.isActive,
    );
    if (!countryRate) {
      // Fallback: try India, then first active rate, then a hardcoded default
      countryRate = config.countryRates.find(
        (r) => r.countryCode === 'IN' && r.isActive,
      );
      if (!countryRate) {
        countryRate = config.countryRates.find((r) => r.isActive);
      }
      if (!countryRate) {
        this.logger.warn(`No country rate found for ${dto.country}, using hardcoded fallback`);
        countryRate = { countryCode: dto.country!, countryName: 'Unknown', costPerGram: 0.015, currencySymbol: '₹', isActive: true };
      } else {
        this.logger.warn(`Country code ${dto.country} not configured — falling back to ${countryRate.countryCode}`);
      }
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
    const cost_savings =
      Math.round(foodSaved * countryRate.costPerGram * 100) / 100;

    return {
      co2_savings,
      cost_savings,
      food_saved: Math.round(foodSaved),
      currency_symbol: countryRate.currencySymbol,
    };
  }

  async checkEligibility(userId: string): Promise<SurveyEligibilityDto> {
    const userIdObj = new Types.ObjectId(userId);
    const config = await this.surveyConfigService.getActiveConfig();
    const uiCfg = config.uiConfig;

    const lastSurvey = await this.trackSurveyModel
      .findOne({ userId: userIdObj })
      .sort({ surveyWeek: -1 })
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

    const currentWeekStart = this.getWeekStart(lastSurvey.surveyDay);
    const lastSurveyWeek = new Date(lastSurvey.surveyWeek);

    const eligible = currentWeekStart.getTime() > lastSurveyWeek.getTime();

    const nextSurveyDate = this.getNextSurveyDate(
      lastSurveyWeek,
      lastSurvey.surveyDay,
    );

    return {
      eligible,
      next_survey_date: nextSurveyDate.toISOString(),
      last_survey_date: lastSurvey.completedAt.toISOString(),
      surveys_count: totalSurveys,
      message: eligible
        ? (uiCfg?.eligibilityMessage || 'Ready to take this week\'s survey!')
        : (uiCfg?.notEligibleMessage || 'You\'ve already completed this week\'s survey'),
    };
  }

  async createSurvey(
    userId: string,
    dto: CreateTrackSurveyDto,
  ): Promise<TrackSurveyResponseDto> {
    const userIdObj = new Types.ObjectId(userId);

    const eligibility = await this.checkEligibility(userId);
    if (!eligibility.eligible) {
      throw new BadRequestException(
        'You have already completed a survey for this week',
      );
    }

    const surveyDay = dto.surveyDay ?? new Date().getDay();
    const weekStart = this.getWeekStart(surveyDay);

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

    const surveys = await this.trackSurveyModel
      .find({ userId: userIdObj })
      .sort({ surveyWeek: -1 })
      .lean();

    return surveys.map((s) => this.toResponseDto(s));
  }

  async getLatestSurvey(userId: string): Promise<TrackSurveyResponseDto> {
    const userIdObj = new Types.ObjectId(userId);

    const survey = await this.trackSurveyModel
      .findOne({ userId: userIdObj })
      .sort({ surveyWeek: -1 })
      .lean();

    if (!survey) {
      throw new NotFoundException('No surveys found for this user');
    }

    return this.toResponseDto(survey);
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

    const personalBests = await this.getPersonalBests(userId);
    const allSurveys = await this.trackSurveyModel
      .find({ userId: userIdObj })
      .lean();

    const totalSavings = allSurveys.reduce(
      (acc, survey) => ({
        co2: acc.co2 + survey.calculatedSavings.co2_savings,
        cost: acc.cost + survey.calculatedSavings.cost_savings,
        food: acc.food + survey.calculatedSavings.food_saved,
      }),
      { co2: 0, cost: 0, food: 0 },
    );

    return {
      current_week: surveys[0].calculatedSavings,
      previous_week: surveys[1]?.calculatedSavings || null,
      personal_bests: {
        ...personalBests,
        currency_symbol: surveys[0].calculatedSavings.currency_symbol ?? '₹',
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
