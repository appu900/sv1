import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CampaignSurveyResponse,
  CampaignSurveyResponseSchema,
} from '../../database/schemas/campaign-survey-response.schema';
import { User, UserSchema } from '../../database/schemas/user.auth.schema';
import { CampaignSurveyController } from './campaign-survey.controller';
import { CampaignSurveyService } from './campaign-survey.service';

/** One-off surveys with a thank-you gift (Christmas Food Report 2026). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CampaignSurveyResponse.name, schema: CampaignSurveyResponseSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CampaignSurveyController],
  providers: [CampaignSurveyService],
})
export class CampaignSurveyModule {}
