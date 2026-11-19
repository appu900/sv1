import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiJwtAuth } from 'src/common/swagger/api-auth.decorators';
import { CampaignSurveyService } from './campaign-survey.service';

@ApiTags('Campaign survey')
@ApiJwtAuth()
@Controller('campaign-survey')
@UseGuards(JwtAuthGuard)
export class CampaignSurveyController {
  constructor(private readonly service: CampaignSurveyService) {}

  /** Status, questions (while it can be answered) and the gift on offer. */
  @Get(':campaignId')
  getStatus(@GetUser() user: any, @Param('campaignId') campaignId: string) {
    return this.service.getStatus(user.userId, campaignId);
  }

  /** Body: { answers: [{ questionId, selected: string[], other?: string }] } */
  @Post(':campaignId/responses')
  @HttpCode(200)
  submit(
    @GetUser() user: any,
    @Param('campaignId') campaignId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.submit(user.userId, campaignId, body);
  }

  @Post(':campaignId/activate')
  @HttpCode(200)
  activate(@GetUser() user: any, @Param('campaignId') campaignId: string) {
    return this.service.activate(user.userId, campaignId);
  }
}
