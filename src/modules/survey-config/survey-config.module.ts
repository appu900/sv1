import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SurveyConfigService } from './survey-config.service';
import { SurveyConfigController } from './survey-config.controller';
import {
  SurveyConfig,
  SurveyConfigSchema,
} from 'src/database/schemas/survey-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SurveyConfig.name, schema: SurveyConfigSchema },
    ]),
  ],
  controllers: [SurveyConfigController],
  providers: [SurveyConfigService],
  exports: [SurveyConfigService],
})
export class SurveyConfigModule implements OnModuleInit {
  private readonly logger = new Logger(SurveyConfigModule.name);
  constructor(private readonly surveyConfigService: SurveyConfigService) {}

  async onModuleInit() {
    // First try normal seed (only runs when DB is empty)
    await this.surveyConfigService.seedDefaultIfEmpty();

    // Auto-migrate: if existing active config still has emoji icons, reseed
    try {
      const active = await this.surveyConfigService.getActiveConfig();
      const hasEmojiIcons = active?.produceWasteCategories?.some(
        (c: any) => c.icon && /[\u{1F000}-\u{1FFFF}]/u.test(c.icon),
      );
      if (hasEmojiIcons) {
        this.logger.warn('Detected emoji icons in active config — re-seeding with asset keys…');
        await this.surveyConfigService.reseed();
      }
    } catch (_) {
      // ignore — getActiveConfig already falls back to defaults
    }
  }
}
