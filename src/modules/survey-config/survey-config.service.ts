import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SurveyConfig,
  SurveyConfigDocument,
} from 'src/database/schemas/survey-config.schema';
import { CreateSurveyConfigDto } from './dto/create-survey-config.dto';
import { UpdateSurveyConfigDto } from './dto/update-survey-config.dto';

@Injectable()
export class SurveyConfigService {
  private readonly logger = new Logger(SurveyConfigService.name);

  private cachedActiveConfig: SurveyConfigDocument | null = null;

  constructor(
    @InjectModel(SurveyConfig.name)
    private configModel: Model<SurveyConfigDocument>,
  ) {}

  async create(dto: CreateSurveyConfigDto): Promise<SurveyConfigDocument> {
    if (dto.isActive) {
      await this.deactivateAll();
    }
    const config = new this.configModel(dto);
    const saved = await config.save();
    this.invalidateCache();
    return saved;
  }

  async findAll(): Promise<SurveyConfigDocument[]> {
    return this.configModel.find().sort({ updatedAt: -1 }).lean().exec();
  }

  async findById(id: string): Promise<SurveyConfigDocument> {
    const config = await this.configModel.findById(id).lean().exec();
    if (!config) throw new NotFoundException(`SurveyConfig ${id} not found`);
    return config;
  }

  async update(
    id: string,
    dto: UpdateSurveyConfigDto,
  ): Promise<SurveyConfigDocument> {
    if (dto.isActive) {
      await this.deactivateAll();
    }
    const updated = await this.configModel
      .findByIdAndUpdate(id, { $set: dto, $inc: { version: 1 } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(`SurveyConfig ${id} not found`);
    this.invalidateCache();
    return updated;
  }

  async remove(id: string): Promise<{ message: string }> {
    const config = await this.configModel.findById(id);
    if (!config) throw new NotFoundException(`SurveyConfig ${id} not found`);
    if (config.isActive) {
      throw new BadRequestException(
        'Cannot delete the active configuration. Deactivate it first.',
      );
    }
    await this.configModel.findByIdAndDelete(id);
    this.invalidateCache();
    return { message: 'Survey config deleted successfully' };
  }

  async toggleActive(id: string): Promise<SurveyConfigDocument> {
    const config = await this.configModel.findById(id);
    if (!config) throw new NotFoundException(`SurveyConfig ${id} not found`);

    if (!config.isActive) {
      await this.deactivateAll();
    }
    config.isActive = !config.isActive;
    const saved = await config.save();
    this.invalidateCache();
    return saved;
  }


  async getActiveConfig(): Promise<SurveyConfigDocument> {
    if (this.cachedActiveConfig) return this.cachedActiveConfig;

    const config = await this.configModel
      .findOne({ isActive: true })
      .lean()
      .exec();

    if (!config) {
      this.logger.warn('No active survey config found — returning defaults');
      return this.getDefaultConfig();
    }

    this.cachedActiveConfig = config;
    return config;
  }

  async seedDefaultIfEmpty(): Promise<void> {
    const count = await this.configModel.countDocuments();
    if (count > 0) return;

    this.logger.log('Seeding default survey config…');
    const defaults = this.getDefaultConfig();
    const config = new this.configModel(defaults);
    await config.save();
    this.invalidateCache();
    this.logger.log('Default survey config seeded.');
  }

  /**
   * Force re-seed: drops ALL existing configs and creates a fresh default.
   * Useful when the default schema/icons have changed.
   */
  async reseed(): Promise<void> {
    this.logger.log('Force re-seeding survey config…');
    await this.configModel.deleteMany({});
    const defaults = this.getDefaultConfig();
    const config = new this.configModel(defaults);
    await config.save();
    this.invalidateCache();
    this.logger.log('Survey config re-seeded successfully.');
  }

  private async deactivateAll() {
    await this.configModel.updateMany(
      { isActive: true },
      { $set: { isActive: false } },
    );
  }

  private invalidateCache() {
    this.cachedActiveConfig = null;
  }

  private getDefaultConfig(): any {
    return {
      name: 'Default Configuration',
      isActive: true,
      version: 1,
      surveyQuestions: [
        {
          key: 'cookingFrequency',
          label: 'How many times did you cook this week?',
          type: 'number',
          min: 0,
          max: 50,
          step: 1,
          unit: 'times',
          description: 'Number of meals you cooked at home',
          order: 1,
          isRequired: true,
          isActive: true,
        },
        {
          key: 'scraps',
          label: 'Cupfuls of scraps thrown away?',
          type: 'number',
          min: 0,
          max: 30,
          step: 1,
          unit: 'cupfuls',
          description: 'Peels, stems, bones and other unavoidable scraps',
          order: 2,
          isRequired: true,
          isActive: true,
        },
        {
          key: 'uneatenLeftovers',
          label: 'Containers of uneaten leftovers discarded?',
          type: 'number',
          min: 0,
          max: 20,
          step: 1,
          unit: 'containers',
          description: 'Cooked food that went to waste',
          order: 3,
          isRequired: true,
          isActive: true,
        },
      ],
      produceWasteCategories: [
        { key: 'fruit', label: 'Fruit', icon: 'fruit', weightPerUnit: 150, unit: 'pieces', order: 1, isActive: true },
        { key: 'veggies', label: 'Vegetables', icon: 'veggies', weightPerUnit: 100, unit: 'pieces', order: 2, isActive: true },
        { key: 'dairy', label: 'Dairy', icon: 'dairy', weightPerUnit: 1000, unit: 'kg', order: 3, isActive: true },
        { key: 'bread', label: 'Bread', icon: 'bread', weightPerUnit: 400, unit: 'loaves', order: 4, isActive: true },
        { key: 'meat', label: 'Meat', icon: 'meat', weightPerUnit: 1000, unit: 'kg', order: 5, isActive: true },
        { key: 'herbs', label: 'Herbs', icon: 'herbs', weightPerUnit: 50, unit: 'bunches', order: 6, isActive: true },
      ],
      countryRates: [
        { countryCode: 'IN', countryName: 'India', costPerGram: 0.015, currencySymbol: '₹', isActive: true },
        { countryCode: 'AU', countryName: 'Australia', costPerGram: 0.004, currencySymbol: 'A$', isActive: true },
        { countryCode: 'NZ', countryName: 'New Zealand', costPerGram: 0.005, currencySymbol: 'NZ$', isActive: true },
        { countryCode: 'US', countryName: 'United States', costPerGram: 0.003, currencySymbol: '$', isActive: true },
        { countryCode: 'GB', countryName: 'United Kingdom', costPerGram: 0.0035, currencySymbol: '£', isActive: true },
        { countryCode: 'CA', countryName: 'Canada', costPerGram: 0.004, currencySymbol: 'C$', isActive: true },
        { countryCode: 'CN', countryName: 'China', costPerGram: 0.02, currencySymbol: '¥', isActive: true },
        { countryCode: 'JP', countryName: 'Japan', costPerGram: 0.4, currencySymbol: '¥', isActive: true },
        { countryCode: 'KR', countryName: 'South Korea', costPerGram: 3.0, currencySymbol: '₩', isActive: true },
        { countryCode: 'SG', countryName: 'Singapore', costPerGram: 0.004, currencySymbol: 'S$', isActive: true },
        { countryCode: 'AE', countryName: 'UAE', costPerGram: 0.012, currencySymbol: 'AED', isActive: true },
        { countryCode: 'DE', countryName: 'Germany', costPerGram: 0.003, currencySymbol: '€', isActive: true },
        { countryCode: 'FR', countryName: 'France', costPerGram: 0.003, currencySymbol: '€', isActive: true },
      ],
      calculationConstants: {
        // Matches CO2_KG_PER_KG_FOOD_SAVED (analytics/utils/impact-pricing.util.ts).
        co2PerGram: 2.1,
        avgWeeklyWasteGrams: 5000,
        scrapsWeightPerUnit: 150,
        leftoversWeightPerUnit: 500,
      },
      weeklyTips: [
        {
          title: 'Plan Your Meals',
          content: 'Planning meals for the week can reduce food waste by up to 25%. Make a shopping list and stick to it!',
          imageUrl: '',
          weekNumber: 1,
          isActive: true,
          order: 1,
        },
        {
          title: 'Store Smart',
          content: 'Keep fruits and vegetables in the right spots in your fridge. Leafy greens last longer in airtight containers with a paper towel.',
          imageUrl: '',
          weekNumber: 2,
          isActive: true,
          order: 2,
        },
        {
          title: 'Love Your Leftovers',
          content: 'Transform leftovers into new meals. Yesterday\'s rice becomes today\'s fried rice!',
          imageUrl: '',
          weekNumber: 3,
          isActive: true,
          order: 3,
        },
        {
          title: 'Freeze Before It Expires',
          content: 'If you can\'t eat it in time, freeze it! Most foods can be frozen to extend their life by months.',
          imageUrl: '',
          weekNumber: 4,
          isActive: true,
          order: 4,
        },
      ],
      uiConfig: {
        surveyTitle: 'Weekly Food Waste Survey',
        surveyDescription: 'Track your weekly food waste to help reduce it.',
        completionMessage: 'Great job completing your weekly survey!',
        eligibilityMessage: "Ready to take this week's survey!",
        notEligibleMessage: "You've already completed this week's survey",
      },
    };
  }
}
