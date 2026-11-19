import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CampaignSurveyService } from './campaign-survey.service';

const userId = new Types.ObjectId().toHexString();
const OPEN = new Date('2026-12-05T00:00:00Z');

const answers = [
  { questionId: 'food_budget_change', selected: ['same'] },
  { questionId: 'food_spend', selected: ['250_499'] },
  { questionId: 'cost_pressures', selected: ['specials'] },
  { questionId: 'total_spend_change', selected: ['same'] },
  { questionId: 'budget_plans', selected: ['plan_ahead'] },
  { questionId: 'leftovers', selected: ['not_applicable'] },
];

function setup(opts: { country?: string; storePlan?: 'basic' | 'hero' | 'legend'; existing?: any; testUsers?: string } = {}) {
  let stored: any = opts.existing ?? null;
  const responseModel = {
    findOne: jest.fn(() => ({ lean: () => ({ exec: async () => stored }) })),
    create: jest.fn(async (doc: any) => {
      stored = { _id: new Types.ObjectId(), ...doc };
      return stored;
    }),
    updateOne: jest.fn(async (_f: any, update: any) => {
      stored = { ...stored, ...update.$set };
    }),
  };
  const userModel = {
    findById: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => ({ country: opts.country ?? 'AU' }) }) }) })),
  };
  const subscriptionService = {
    getStoreEffectivePlan: jest.fn(async () => opts.storePlan ?? 'basic'),
    grantGift: jest.fn(async () => ({})),
  };
  const config = { get: jest.fn(() => opts.testUsers ?? '') };
  const service = new CampaignSurveyService(
    responseModel as any,
    userModel as any,
    subscriptionService as any,
    config as any,
  );
  return { service, responseModel, subscriptionService, get stored() { return stored; } };
}

describe('CampaignSurveyService', () => {
  it('shows the questions and a Hero offer to a free Australian user', async () => {
    const { service } = setup();
    const status = await service.getStatus(userId, 'christmas-2026', OPEN);
    expect(status.status).toBe('not_started');
    expect(status.canAnswer).toBe(true);
    expect(status.questions).toHaveLength(6);
    expect(status.giftOffer).toBe('hero');
  });

  it('hides the questions outside Australia', async () => {
    const { service } = setup({ country: 'India' });
    const status = await service.getStatus(userId, 'christmas-2026', OPEN);
    expect(status.canAnswer).toBe(false);
    expect(status.reason).toBe('country');
    expect(status.questions).toEqual([]);
    await expect(service.submit(userId, 'christmas-2026', { answers }, OPEN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts one complete response and refuses a second', async () => {
    const t = setup();
    const status = await t.service.submit(userId, 'christmas-2026', { answers }, OPEN);
    expect(status.status).toBe('completed');
    expect(status.canActivate).toBe(true);
    await expect(t.service.submit(userId, 'christmas-2026', { answers }, OPEN)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects incomplete answers', async () => {
    const { service } = setup();
    await expect(service.submit(userId, 'christmas-2026', { answers: answers.slice(0, 5) }, OPEN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grants Hero to a free user for two months from activation', async () => {
    const t = setup();
    await t.service.submit(userId, 'christmas-2026', { answers }, OPEN);
    const status = await t.service.activate(userId, 'christmas-2026', OPEN);
    expect(t.subscriptionService.grantGift).toHaveBeenCalledWith(userId, {
      plan: 'hero',
      source: 'christmas-2026',
      startsAt: OPEN,
      expiresAt: new Date('2027-02-05T00:00:00Z'),
    });
    expect(status.status).toBe('activated');
    expect(status.gift?.plan).toBe('hero');
  });

  it('grants Legend to a paying Hero member and nothing to Legend', async () => {
    const hero = setup({ storePlan: 'hero' });
    await hero.service.submit(userId, 'christmas-2026', { answers }, OPEN);
    await hero.service.activate(userId, 'christmas-2026', OPEN);
    expect((hero.subscriptionService.grantGift as jest.Mock).mock.calls[0][1].plan).toBe('legend');

    const legend = setup({ storePlan: 'legend' });
    await legend.service.submit(userId, 'christmas-2026', { answers }, OPEN);
    const status = await legend.service.activate(userId, 'christmas-2026', OPEN);
    expect(legend.subscriptionService.grantGift).not.toHaveBeenCalled();
    expect(status.status).toBe('activated');
    expect(status.gift?.plan).toBeNull();
  });

  it('refuses activation after 31 December', async () => {
    const t = setup();
    await t.service.submit(userId, 'christmas-2026', { answers }, OPEN);
    await expect(t.service.activate(userId, 'christmas-2026', new Date('2027-01-01T00:00:00Z'))).rejects.toBeInstanceOf(GoneException);
  });

  it('lets QA accounts take part before it opens', async () => {
    const { service } = setup({ country: 'India', testUsers: `other,${userId}` });
    const status = await service.getStatus(userId, 'christmas-2026', new Date('2026-11-20T00:00:00Z'));
    expect(status.canAnswer).toBe(true);
  });
});
