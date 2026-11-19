import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignSurveyResponse,
  CampaignSurveyResponseDocument,
} from '../../database/schemas/campaign-survey-response.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { normalizeCountry } from '../../utils/countries.util';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  addCalendarMonths,
  answerBlocker,
  canActivate,
  giftFor,
  validateAnswers,
} from './campaign-rules';
import { CAMPAIGNS, CampaignDefinition } from './campaigns';

@Injectable()
export class CampaignSurveyService {
  constructor(
    @InjectModel(CampaignSurveyResponse.name)
    private readonly responseModel: Model<CampaignSurveyResponseDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly subscriptionService: SubscriptionService,
    private readonly config: ConfigService,
  ) {}

  private campaign(id: string): CampaignDefinition {
    const campaign = CAMPAIGNS[id];
    if (!campaign) throw new NotFoundException('Survey not found');
    return campaign;
  }

  /** QA accounts that skip the dates and the country check. */
  private isTestUser(userId: string): boolean {
    const raw = this.config.get<string>('CAMPAIGN_SURVEY_TEST_USER_IDS') ?? '';
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .includes(userId);
  }

  private async countryOf(userId: string): Promise<string | undefined> {
    const user = await this.userModel.findById(userId).select('country').lean().exec();
    return normalizeCountry((user as any)?.country ?? undefined);
  }

  private findResponse(userId: string, campaignId: string) {
    return this.responseModel
      .findOne({ userId: new Types.ObjectId(userId), campaignId })
      .lean()
      .exec();
  }

  /** Everything the app needs to decide what to show. */
  async getStatus(userId: string, campaignId: string, now = new Date()) {
    const campaign = this.campaign(campaignId);
    const bypass = this.isTestUser(userId);
    const [response, country, storePlan] = await Promise.all([
      this.findResponse(userId, campaignId),
      this.countryOf(userId),
      this.subscriptionService.getStoreEffectivePlan(userId),
    ]);
    const activated = !!response?.gift?.activatedAt;
    const status = !response ? 'not_started' : activated ? 'activated' : 'completed';
    const blocker = response ? null : answerBlocker(campaign, { now, country, bypass });
    const giftOffer = activated ? response!.gift!.plan : giftFor(storePlan);
    return {
      campaignId: campaign.id,
      title: campaign.title,
      status,
      canAnswer: !response && !blocker,
      reason: blocker,
      canActivate: status === 'completed' && canActivate(campaign, now, bypass),
      giftOffer,
      giftMonths: campaign.giftMonths,
      gift: response?.gift ?? null,
      opensAt: campaign.opensAt,
      closesAt: campaign.closesAt,
      activateBy: campaign.activateBy,
      questions: !response && !blocker ? campaign.questions : [],
    };
  }

  async submit(userId: string, campaignId: string, body: unknown, now = new Date()) {
    const campaign = this.campaign(campaignId);
    if (await this.findResponse(userId, campaignId)) {
      throw new ConflictException('You’ve already completed this survey.');
    }
    const country = await this.countryOf(userId);
    const blocker = answerBlocker(campaign, { now, country, bypass: this.isTestUser(userId) });
    if (blocker) {
      throw new ForbiddenException({
        code: blocker,
        message:
          blocker === 'country'
            ? 'This survey is only open to Saveful members in Australia.'
            : blocker === 'closed'
              ? 'This survey has closed.'
              : 'This survey isn’t open yet.',
      });
    }
    const result = validateAnswers(campaign, (body as { answers?: unknown } | null)?.answers);
    if (!result.ok) throw new BadRequestException(result.error);
    try {
      await this.responseModel.create({
        userId: new Types.ObjectId(userId),
        campaignId,
        answers: result.answers,
        country,
        completedAt: now,
        gift: null,
      });
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException('You’ve already completed this survey.');
      throw err;
    }
    return this.getStatus(userId, campaignId, now);
  }

  /**
   * Activates the thank-you: free users get Hero, paying Hero members get
   * Legend, for `giftMonths` calendar months from now. Legend members get a
   * thank-you only. Safe to call twice.
   */
  async activate(userId: string, campaignId: string, now = new Date()) {
    const campaign = this.campaign(campaignId);
    const response = await this.findResponse(userId, campaignId);
    if (!response) throw new BadRequestException('Complete the survey first.');
    if (response.gift?.activatedAt) return this.getStatus(userId, campaignId, now);
    if (!canActivate(campaign, now, this.isTestUser(userId))) {
      throw new GoneException('This gift had to be activated by 31 December.');
    }
    const plan = giftFor(await this.subscriptionService.getStoreEffectivePlan(userId));
    const expiresAt = addCalendarMonths(now, campaign.giftMonths);
    if (plan) {
      await this.subscriptionService.grantGift(userId, {
        plan,
        source: campaign.id,
        startsAt: now,
        expiresAt,
      });
    }
    await this.responseModel.updateOne(
      { _id: (response as any)._id, 'gift.activatedAt': { $exists: false } },
      { $set: { gift: { plan, activatedAt: now, ...(plan ? { expiresAt } : {}) } } },
    );
    return this.getStatus(userId, campaignId, now);
  }
}
