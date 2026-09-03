import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { TrackSurveyService } from './track-survey.service';
import { CreateTrackSurveyDto } from './dto/create-track-survey.dto';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiJwtAuth } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Survey')
@ApiJwtAuth()
@Controller('track-survey')
@UseGuards(JwtAuthGuard)
export class TrackSurveyController {
  constructor(private readonly trackSurveyService: TrackSurveyService) {}

  @Get('eligibility')
  @ApiOperation({
    summary: 'Check survey eligibility',
    description:
      'Returns whether the authenticated user should be shown the current tracking survey (based on cadence, prior submissions, and the active survey config).',
  })
  @ApiOkResponse({ description: 'Eligibility payload.' })
  async checkEligibility(@GetUser() user: any) {
    return this.trackSurveyService.checkEligibility(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a tracking survey',
    description:
      'Stores the authenticated user’s answers for the current tracking survey. Typically called after the in-app survey form is completed.',
  })
  @ApiBody({ type: CreateTrackSurveyDto })
  @ApiCreatedResponse({ description: 'Survey response saved.' })
  async createSurvey(
    @GetUser() user: any,
    @Body() createTrackSurveyDto: CreateTrackSurveyDto,
  ) {
    return this.trackSurveyService.createSurvey(
      user.userId,
      createTrackSurveyDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List the user’s survey responses',
    description:
      'Returns all tracking-survey submissions belonging to the authenticated user, newest first.',
  })
  @ApiOkResponse({ description: 'User survey responses.' })
  async getUserSurveys(@GetUser() user: any) {
    return this.trackSurveyService.getUserSurveys(user.userId);
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Get the latest survey response',
    description:
      'Returns the authenticated user’s most recent tracking-survey submission, or empty when they have never submitted.',
  })
  @ApiOkResponse({ description: 'Latest survey response.' })
  async getLatestSurvey(@GetUser() user: any) {
    return this.trackSurveyService.getLatestSurvey(user.userId);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get a weekly survey summary',
    description:
      'Returns a weekly rollup of the authenticated user’s tracking-survey answers for progress / insights screens.',
  })
  @ApiOkResponse({ description: 'Weekly survey summary.' })
  async getWeeklySummary(@GetUser() user: any) {
    return this.trackSurveyService.getWeeklySummary(user.userId);
  }
}
