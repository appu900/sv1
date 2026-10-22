import { Types } from 'mongoose';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralAttributionStatus } from '../../database/schemas/referral-attribution.schema';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ReferralBindRejection } from './referral.constants';

/** Awaitable stand-in for a Mongoose query chain. */
function chain(value: unknown) {
  const query: any = {
    select: () => query,
    lean: () => query,
    then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
  };
  return query;
}

const chefUserId = new Types.ObjectId();
const subscriberId = new Types.ObjectId();

function setup(opts: {
  resolved?: any;
  user?: any;
  subscription?: any;
  existing?: any;
} = {}) {
  const resolved =
    opts.resolved === undefined
      ? {
          code: { _id: new Types.ObjectId(), code: 'ANNA7K2' },
          chefUser: { _id: chefUserId, name: 'Anna Smith', role: UserRole.CHEF },
          chefProfile: { _id: new Types.ObjectId(), displayName: 'Chef Anna' },
        }
      : opts.resolved;

  const attributionModel = {
    findOne: jest.fn().mockResolvedValue(opts.existing ?? null),
    create: jest.fn(async (doc: any) => ({ _id: new Types.ObjectId(), ...doc })),
  };
  const chefProfileModel = {
    findById: jest.fn(() =>
      chain({ displayName: 'Chef Anna', slug: 'anna-smith', avatarImageUrl: 'https://cdn/a.png' }),
    ),
  };
  const subscriptionModel = { findOne: jest.fn(() => chain(opts.subscription ?? null)) };
  const userModel = {
    findById: jest.fn(() =>
      chain(opts.user === undefined ? { _id: subscriberId, role: UserRole.USER } : opts.user),
    ),
  };
  const codeService = { resolveActive: jest.fn().mockResolvedValue(resolved) };
  const config = { get: jest.fn((key: string) => (key === 'REFERRAL_IOS_OFFER_CODES' ? '{"saveful.hero.monthly":"CHEFHEROM"}' : key === 'REFERRAL_APPLE_APP_ID' ? '123456' : undefined)) };

  const service = new ReferralAttributionService(
    attributionModel as any,
    chefProfileModel as any,
    subscriptionModel as any,
    userModel as any,
    codeService as any,
    config as any,
  );
  return { service, attributionModel, codeService };
}

describe('ReferralAttributionService.bind', () => {
  const userId = subscriberId.toHexString();

  it('binds a never-subscribed customer and snapshots the commission rate', async () => {
    const { service, attributionModel } = setup();
    const result = await service.bind(userId, 'anna7k2', 'link');

    expect(result).toMatchObject({
      status: 'bound',
      referral: { code: 'ANNA7K2', chef: { displayName: 'Chef Anna', slug: 'anna-smith' } },
    });
    expect(attributionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chefUserId,
        source: 'link',
        commissionRateBps: 1000,
        status: ReferralAttributionStatus.BOUND,
      }),
    );
  });

  it('records unknown sources as manual', async () => {
    const { service, attributionModel } = setup();
    await service.bind(userId, 'ANNA7K2', 'telepathy');
    expect(attributionModel.create.mock.calls[0][0].source).toBe('manual');
  });

  it('keeps the first chef: a later code returns already_bound', async () => {
    const existing = {
      code: 'FIRST1',
      boundAt: new Date(),
      status: ReferralAttributionStatus.BOUND,
      chefProfileId: null,
      chefDisplayName: 'First Chef',
    };
    const { service, attributionModel, codeService } = setup({ existing });
    const result = await service.bind(userId, 'ANNA7K2', 'link');

    expect(result).toMatchObject({ status: 'already_bound', referral: { code: 'FIRST1' } });
    expect(attributionModel.create).not.toHaveBeenCalled();
    expect(codeService.resolveActive).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown or disabled code', { resolved: null }, ReferralBindRejection.INVALID_CODE],
    ['missing user', { user: null }, ReferralBindRejection.USER_NOT_FOUND],
    ['chef account', { user: { role: UserRole.CHEF } }, ReferralBindRejection.NOT_ELIGIBLE_ROLE],
    ['admin account', { user: { role: UserRole.ADMIN } }, ReferralBindRejection.NOT_ELIGIBLE_ROLE],
    ['used a trial', { subscription: { plan: 'basic', trialsConsumed: { hero: new Date() } } }, ReferralBindRejection.ALREADY_SUBSCRIBED],
    ['subscribed before', { subscription: { plan: 'basic', purchasedAt: new Date() } }, ReferralBindRejection.ALREADY_SUBSCRIBED],
    ['currently subscribed', { subscription: { plan: 'legend' } }, ReferralBindRejection.ALREADY_SUBSCRIBED],
  ])('rejects: %s', async (_label, opts, reason) => {
    const { service, attributionModel } = setup(opts as any);
    await expect(service.bind(userId, 'ANNA7K2', 'link')).resolves.toEqual({
      status: 'rejected',
      reason,
    });
    expect(attributionModel.create).not.toHaveBeenCalled();
  });

  it('rejects a chef referring their own account', async () => {
    const { service } = setup({ user: { _id: chefUserId, role: UserRole.USER } });
    await expect(service.bind(chefUserId.toHexString(), 'ANNA7K2', 'link')).resolves.toEqual({
      status: 'rejected',
      reason: ReferralBindRejection.SELF_REFERRAL,
    });
  });

  it('allows a basic-plan record with no purchase history', async () => {
    const { service } = setup({ subscription: { plan: 'basic' } });
    await expect(service.bind(userId, 'ANNA7K2', 'link')).resolves.toMatchObject({ status: 'bound' });
  });

  it('resolves a concurrent double bind to the winner', async () => {
    const { service, attributionModel } = setup();
    attributionModel.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    attributionModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        code: 'ANNA7K2',
        boundAt: new Date(),
        status: ReferralAttributionStatus.BOUND,
        chefProfileId: null,
        chefDisplayName: 'Chef Anna',
      });
    await expect(service.bind(userId, 'ANNA7K2', 'link')).resolves.toMatchObject({
      status: 'already_bound',
    });
  });

  it('bindSafely never throws into signup', async () => {
    const { service, codeService } = setup();
    codeService.resolveActive.mockRejectedValueOnce(new Error('db down'));
    await expect(service.bindSafely(userId, 'ANNA7K2', 'signup')).resolves.toBeNull();
  });
});

describe('ReferralAttributionService.getMine', () => {
  const userId = subscriberId.toHexString();
  const bound = {
    code: 'ANNA7K2',
    boundAt: new Date(),
    status: ReferralAttributionStatus.BOUND,
    chefProfileId: new Types.ObjectId(),
    chefDisplayName: 'Chef Anna',
  };

  it('offers the discount, with store details, to a bound customer who never subscribed', async () => {
    const { service } = setup({ existing: bound });
    const mine = await service.getMine(userId);
    expect(mine.referral?.code).toBe('ANNA7K2');
    expect(mine.discount).toEqual({
      eligible: true,
      percent: 5,
      trialDays: 7,
      ios: { appStoreId: '123456', offerCodes: { 'saveful.hero.monthly': 'CHEFHEROM' } },
      android: { offerTag: 'chef-referral' },
    });
  });

  it('withdraws the discount once a trial has started', async () => {
    const { service } = setup({ existing: { ...bound, status: ReferralAttributionStatus.TRIALING } });
    expect((await service.getMine(userId)).discount.eligible).toBe(false);
  });

  it('has no referral and no discount for unreferred customers', async () => {
    const { service } = setup();
    const mine = await service.getMine(userId);
    expect(mine.referral).toBeNull();
    expect(mine.discount.eligible).toBe(false);
  });
});
