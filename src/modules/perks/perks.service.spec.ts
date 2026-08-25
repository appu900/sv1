import { ConflictException, ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../database/schemas/perks-membership.schema';
import { PerksCartStatus } from '../../database/schemas/perks-cart.schema';
import { PerksSpendFrequency } from './dto/perks.dto';
import { PerksCorpApiError } from './corp/perks-corp-api.client';
import { legacyWalletCardKey } from './corp/perks-corp.mapper';
import { PerksService } from './perks.service';

const userId = new Types.ObjectId().toString();

const lean = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });

const CARD = {
  id: 1,
  name: 'Coles Gift Card',
  image: 'giftcards/3.jpg',
  delivery_fee: '1.00',
  discount: '10.00',
  is_popular: 0,
  categories: [{ id: 14, parent_id: 10, slug: 'groceries', name: 'Groceries' }],
  provider_product: {
    price_type: 'fixed',
    available_denominations: [{ amount: '50.00' }, { amount: '100.00' }],
  },
};

function membershipDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    email: 'tester@saveful.com',
    status: PerksMembershipStatus.ACTIVE,
    wmadUserId: '119',
    credentialVersion: 1,
    registeredAt: new Date('2026-01-01'),
    plan: PerksMembershipPlan.FREE,
    cancelledAt: null,
    accessEndsAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  doc.toObject = () => ({ ...doc });
  return doc;
}

function cartDoc(items: unknown[] = []) {
  const doc: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    status: PerksCartStatus.ACTIVE,
    items,
    save: jest.fn().mockResolvedValue(undefined),
  };
  doc.toObject = () => ({ ...doc, items: doc.items });
  doc.lean = jest.fn(async () => ({ ...doc, items: doc.items }));
  return doc;
}

function createService(overrides: Record<string, unknown> = {}) {
  const userModel = {
    findById: jest.fn(() =>
      lean({
        _id: userId,
        name: 'Saveful Tester',
        email: 'tester@saveful.com',
        pincode: '5000',
        phoneNumber: '0400000000',
        gender: 'male',
      }),
    ),
  };
  const healthProfileModel = {
    findOne: jest.fn(() => ({ select: jest.fn(() => lean(null)) })),
  };
  const membership = membershipDoc();
  const membershipModel = {
    findOne: jest.fn(() => {
      const result = membership as Record<string, unknown>;
      result.lean = jest.fn().mockResolvedValue({ ...membership });
      return result;
    }),
    create: jest.fn(),
  };
  const membershipEventModel = { create: jest.fn(), find: jest.fn() };
  const favouriteModel = {
    find: jest.fn(() => ({ sort: jest.fn(() => lean([])) })),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  const cart = cartDoc();
  const cartModel = {
    findOne: jest.fn(() => cart),
    create: jest.fn().mockResolvedValue(cart),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const walletMetadataModel = {
    find: jest.fn(() => lean([])),
    findOneAndUpdate: jest.fn(),
  };
  const calculatorProfileModel = {
    findOne: jest.fn(() => lean(null)),
    findOneAndUpdate: jest.fn(),
  };

  const store = new Map<string, unknown>();
  const locks = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    setIfAbsent: jest.fn(async (key: string, value: string) => {
      if (locks.has(key)) return false;
      locks.set(key, value);
      return true;
    }),
    releaseLock: jest.fn(async (key: string) => {
      locks.delete(key);
      return true;
    }),
  };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };
  let upstreamCart: Record<string, unknown>[] = [];
  const api = {
    listGiftCards: jest.fn().mockResolvedValue([CARD]),
    // The catalogue now walks every page rather than reading page 1 only.
    listAllGiftCards: jest.fn().mockResolvedValue([CARD]),
    getGiftCard: jest.fn().mockResolvedValue({ gift_card: CARD }),
    getCart: jest.fn(async () => [...upstreamCart]),
    addToCart: jest.fn(async () => {
      upstreamCart.push({ id: upstreamCart.length + 1 });
    }),
    removeFromCart: jest.fn(async (_t: string, id: number | string) => {
      upstreamCart = upstreamCart.filter((row) => row.id !== id);
    }),
    listOrders: jest.fn().mockResolvedValue([]),
    listMyGiftCards: jest.fn().mockResolvedValue([]),
    buildCheckoutUrl: jest.fn(
      (token: string) => `https://frontend.test/sso/login?token=${token}`,
    ),
  };
  const session = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access-1',
      webToken: 'web-fresh',
      wmadUserId: '119',
    }),
    getAccessToken: jest.fn().mockResolvedValue('access-1'),
    withAccessToken: jest.fn((_u: string, _user: unknown, run: (t: string) => unknown) =>
      run('access-1'),
    ),
    clearCachedToken: jest.fn(),
    missingProfileFields: jest.fn().mockReturnValue([]),
    // My Perks sells one WeMAD tier, Platinum; without it every card is 0% off.
    membershipTierId: '3',
    applyMembershipTier: jest.fn().mockResolvedValue('3'),
    createCheckoutUrl: jest.fn(
      async (s: { accessToken: string; webToken: string }) =>
        `https://frontend.test/sso/login?token=${s.webToken}`,
    ),
  };

  Object.assign(api, overrides.api);
  Object.assign(session, overrides.session);
  Object.assign(membershipModel, overrides.membershipModel);
  Object.assign(cartModel, overrides.cartModel);
  const billing = {
    entitlementFor: jest.fn().mockReturnValue({
      entitled: true,
      reason: 'billing_disabled',
      paymentRequired: false,
    }),
    describe: jest.fn().mockReturnValue({
      required: false,
      reason: 'billing_disabled',
      priceLabel: null,
      subscriptionStatus: 'none',
      cancelAtPeriodEnd: false,
      accessEndsAt: null,
      manageable: false,
    }),
    scheduleCancellation: jest.fn().mockResolvedValue(null),
    resumeSubscription: jest.fn().mockResolvedValue(null),
    // Stripe says no subscription unless a test says otherwise.
    reconcileFromStripe: jest.fn().mockResolvedValue(false),
  };
  Object.assign(billing, overrides.billing);

  Object.assign(walletMetadataModel, overrides.walletMetadataModel);
  Object.assign(redis, overrides.redis);
  Object.assign(config, overrides.config);

  return {
    service: new PerksService(
      userModel as never,
      healthProfileModel as never,
      membershipModel as never,
      membershipEventModel as never,
      favouriteModel as never,
      cartModel as never,
      walletMetadataModel as never,
      calculatorProfileModel as never,
      api as never,
      session as never,
      billing as never,
      redis as never,
      config as never,
    ),
    api,
    session,
    billing,
    membership,
    membershipModel,
    membershipEventModel,
    cart,
    cartModel,
  };
}

describe('PerksService (corp)', () => {
  describe('catalogue', () => {
    it('maps and caches the corp listing', async () => {
      const { service, api } = createService();
      const cards = await service.getCatalogue({});

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        id: '1',
        name: 'Coles Gift Card',
        discountPercent: 10,
      });

      await service.getCatalogue({});
      expect(api.listAllGiftCards).toHaveBeenCalledTimes(1);
    });

    it('filters by category and search without re-fetching', async () => {
      const { service } = createService();
      expect(await service.getCatalogue({ category: 'groceries' })).toHaveLength(1);
      expect(await service.getCatalogue({ category: 'fuel' })).toHaveLength(0);
      expect(await service.getCatalogue({ q: 'coles' })).toHaveLength(1);
      expect(await service.getCatalogue({ q: 'nothing' })).toHaveLength(0);
    });

    it('reads denominations from the detail endpoint', async () => {
      const { service } = createService();
      await expect(service.getCatalogueCard('1')).resolves.toMatchObject({
        id: '1',
        availableValues: [50, 100],
      });
    });

    it('rejects a non-numeric card id before calling upstream', async () => {
      const { service, api } = createService();
      await expect(service.getCatalogueCard('../secrets')).rejects.toThrow();
      expect(api.getGiftCard).not.toHaveBeenCalled();
    });
  });

  describe('when Redis is unreachable (commands hang, never reject)', () => {
    const hangingRedis = () => ({
      redis: {
        get: jest.fn(() => new Promise(() => {})),
        set: jest.fn(() => new Promise(() => {})),
        del: jest.fn(() => new Promise(() => {})),
        setIfAbsent: jest.fn(() => new Promise(() => {})),
        releaseLock: jest.fn(() => new Promise(() => {})),
      },
    });

    it('still serves the catalogue instead of hanging', async () => {
      const { service, api } = createService(hangingRedis());
      const cards = await service.getCatalogue({});
      expect(cards).toHaveLength(1);
      expect(api.listAllGiftCards).toHaveBeenCalled();
    }, 15000);

    it('still serves card detail', async () => {
      const { service } = createService(hangingRedis());
      await expect(service.getCatalogueCard('1')).resolves.toMatchObject({
        id: '1',
      });
    }, 15000);

    it('still completes checkout', async () => {
      const cart = cartDoc([
        {
          itemId: 'a',
          ecardId: '1',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
      ]);
      const { service } = createService({
        ...hangingRedis(),
        cartModel: { findOne: jest.fn(() => cart), updateOne: jest.fn() },
      });
      await expect(service.checkoutCart(userId)).resolves.toMatchObject({
        status: 'redirect',
      });
    }, 15000);
  });

  describe('membership', () => {
    it('short-circuits when already active', async () => {
      const { service, session } = createService();
      const result = await service.ensureMembership(userId);
      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(session.login).not.toHaveBeenCalled();
    });

    it('registers a pending membership and records the event', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service, session, membershipEventModel } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
      });

      const result = await service.ensureMembership(userId);
      expect(session.login).toHaveBeenCalled();
      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(pending.wmadUserId).toBe('119');
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'registered' }),
      );
    });

    // Support reads `lastErrorMessage`. Our own sentence tells them nothing they
    // did not already know; WeMAD's says which field was rejected.
    it('records WeMAD\'s own words when sign-up fails, not our paraphrase', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        session: {
          login: jest.fn().mockRejectedValue(
            new UnprocessableEntityException({
              message: 'WeMAD could not verify your Perks account.',
              code: 'PERKS_PROFILE_REJECTED',
              upstreamMessage: 'The phone field must be a valid AU mobile.',
            }),
          ),
        },
      });

      await expect(service.ensureMembership(userId)).rejects.toBeDefined();

      expect(pending.status).toBe(PerksMembershipStatus.FAILED);
      expect(pending.lastErrorMessage).toBe(
        'The phone field must be a valid AU mobile.',
      );
    });

    it('sends an unpaid member to checkout instead of registering them upstream', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        billing: {
          entitlementFor: jest.fn().mockReturnValue({
            entitled: false,
            reason: 'none',
            paymentRequired: true,
          }),
        },
      });

      await expect(service.ensureMembership(userId)).rejects.toMatchObject({
        status: 402,
      });
      expect(session.login).not.toHaveBeenCalled();
    });

    // WeMAD prices discounts per tier and everyone starts on standard, where
    // every card reads per_standard: 0.00. A member who pays A$10/month and is
    // left on standard gets literally no discount, so this is not optional.
    it('puts a newly registered member on the Platinum tier', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
      });

      await service.ensureMembership(userId);

      expect(session.applyMembershipTier).toHaveBeenCalledWith('access-1');
      expect(pending.wmadMembershipId).toBe('3');
    });

    it('still registers them when the tier upgrade fails', async () => {
      // Shopping at standard rates beats being locked out entirely; the tier
      // stays unrecorded so the next visit retries it.
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        session: { applyMembershipTier: jest.fn().mockResolvedValue(null) },
      });

      const result = await service.ensureMembership(userId);

      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(pending.wmadMembershipId).toBeNull();
    });

    it('upgrades a member who registered before the tier existed', async () => {
      const active = membershipDoc({
        status: PerksMembershipStatus.ACTIVE,
        wmadUserId: '119',
        wmadMembershipId: null,
      });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(active) },
      });

      await service.ensureMembership(userId);

      expect(session.applyMembershipTier).toHaveBeenCalled();
      expect(active.wmadMembershipId).toBe('3');
      expect(active.save).toHaveBeenCalled();
    });

    it('does not call WeMAD again once the member is on the right tier', async () => {
      const active = membershipDoc({
        status: PerksMembershipStatus.ACTIVE,
        wmadUserId: '119',
        wmadMembershipId: '3',
      });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(active) },
      });

      await service.ensureMembership(userId);

      expect(session.applyMembershipTier).not.toHaveBeenCalled();
    });

    // A member paid, Stripe took the money, and the webhook never landed. The
    // app's only move on a 402 is to open checkout again, so without this the
    // fix for being locked out is being charged twice.
    it('registers a member Stripe says has paid, even with no webhook applied', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service, session, billing } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        billing: {
          entitlementFor: jest.fn().mockReturnValue({
            entitled: false,
            reason: 'none',
            paymentRequired: true,
          }),
          reconcileFromStripe: jest.fn().mockResolvedValue(true),
        },
      });

      await service.ensureMembership(userId);

      expect(billing.reconcileFromStripe).toHaveBeenCalledWith(pending);
      expect(session.login).toHaveBeenCalled();
    });

    it('asks a lapsed member to renew even while their record still says active', async () => {
      const { service, session } = createService({
        billing: {
          entitlementFor: jest.fn().mockReturnValue({
            entitled: false,
            reason: 'none',
            paymentRequired: true,
          }),
        },
      });

      await expect(service.ensureMembership(userId)).rejects.toMatchObject({
        status: 402,
      });
      expect(session.login).not.toHaveBeenCalled();
    });

    it('blocks shopping once paid access has lapsed', async () => {
      const { service } = createService({
        billing: {
          entitlementFor: jest.fn().mockReturnValue({
            entitled: false,
            reason: 'none',
            paymentRequired: true,
          }),
        },
      });

      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 50,
          quantity: 1,
        } as never),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('names the cart line that blocks the total instead of failing anonymously', async () => {
      const cart = cartDoc([
        {
          itemId: 'a',
          ecardId: '1',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
      ]);
      const { service } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
        api: {
          getGiftCard: jest.fn().mockResolvedValue({
            gift_card: { ...CARD, provider_product: undefined },
          }),
        },
      });

      await expect(service.quoteCart(userId)).rejects.toMatchObject({
        response: {
          code: 'PERKS_CART_LINE_UNAVAILABLE',
          ecardName: 'Coles Gift Card',
          itemId: expect.any(String),
        },
      });
    });

    it('cancels a paid member at period end rather than cutting them off', async () => {
      const scheduled = membershipDoc({
        status: PerksMembershipStatus.ACTIVE,
        cancelAtPeriodEnd: true,
        accessEndsAt: new Date('2026-09-25T00:00:00Z'),
      });
      const { service, membershipEventModel, cartModel } = createService({
        billing: {
          scheduleCancellation: jest.fn().mockResolvedValue(scheduled),
        },
      });

      const result = await service.cancelMembership(userId, {} as never);

      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(cartModel.updateOne).not.toHaveBeenCalled();
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cancelled',
          metadata: expect.objectContaining({ immediate: false }),
        }),
      );
    });

    it('cancels a free member immediately', async () => {
      const { service, membership, cartModel } = createService();

      const result = await service.cancelMembership(userId, {} as never);

      expect(result.status).toBe(PerksMembershipStatus.CANCELLED);
      expect(membership.cancelledAt).toBeInstanceOf(Date);
      expect(cartModel.updateOne).toHaveBeenCalled();
    });

    it('calls off a scheduled cancellation instead of re-registering', async () => {
      const resumed = membershipDoc({
        status: PerksMembershipStatus.ACTIVE,
        cancelAtPeriodEnd: false,
      });
      const { service, session } = createService({
        billing: { resumeSubscription: jest.fn().mockResolvedValue(resumed) },
      });

      const result = await service.resumeMembership(userId);

      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(session.login).not.toHaveBeenCalled();
    });

    it('refuses to silently re-subscribe a cancelled member', async () => {
      const cancelled = membershipDoc({
        status: PerksMembershipStatus.CANCELLED,
      });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(cancelled) },
      });

      await expect(service.ensureMembership(userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(session.login).not.toHaveBeenCalled();
    });

    it('records the failure and rethrows when WeMAD rejects registration', async () => {
      const pending = membershipDoc({ status: PerksMembershipStatus.PENDING });
      const { service, membershipEventModel } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(pending) },
        session: { login: jest.fn().mockRejectedValue(new Error('nope')) },
      });

      await expect(service.ensureMembership(userId)).rejects.toThrow('nope');
      expect(pending.status).toBe(PerksMembershipStatus.FAILED);
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'registration_failed' }),
      );
    });

    it('cancelling drops the upstream token and empties the cart', async () => {
      const { service, session, cartModel, membership, membershipEventModel } =
        createService();

      const result = await service.cancelMembership(userId, { reason: 'too pricey' });

      expect(result.status).toBe(PerksMembershipStatus.CANCELLED);
      expect(membership.cancellationReason).toBe('too pricey');
      expect(session.clearCachedToken).toHaveBeenCalledWith(userId);
      expect(cartModel.updateOne).toHaveBeenCalled();
      expect(membershipEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cancelled' }),
      );
    });

    it('resuming re-authenticates upstream before restoring access', async () => {
      const cancelled = membershipDoc({
        status: PerksMembershipStatus.CANCELLED,
        cancelledAt: new Date(),
      });
      const { service, session } = createService({
        membershipModel: { findOne: jest.fn().mockResolvedValue(cancelled) },
      });

      const result = await service.resumeMembership(userId);
      expect(session.login).toHaveBeenCalled();
      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(cancelled.cancelledAt).toBeNull();
    });
  });

  describe('legacy memberships (pre-corp records)', () => {
    const legacyDoc = () =>
      membershipDoc({
        status: PerksMembershipStatus.ACTIVE,
        wmadUserId: '37463',
        credentialVersion: undefined,
      });

    const withLegacy = () => {
      const doc = legacyDoc();
      return {
        membershipModel: {
          findOne: jest.fn(() => {
            doc.lean = jest.fn().mockResolvedValue({ ...doc });
            return doc;
          }),
        },
      };
    };

    it('reports not_registered rather than the stale active flag', async () => {
      const { service } = createService(withLegacy());
      await expect(service.getMembershipStatus(userId)).resolves.toMatchObject({
        status: 'not_registered',
        wmadUserId: null,
      });
    });

    it('re-registers instead of short-circuiting on the stale flag', async () => {
      const ctx = withLegacy();
      const { service, session } = createService(ctx);

      const result = await service.ensureMembership(userId);
      expect(session.login).toHaveBeenCalled();
      expect(result.status).toBe(PerksMembershipStatus.ACTIVE);
      expect(result.wmadUserId).toBe('119'); 
    });

    it('blocks transacting until re-registered', async () => {
      const { service } = createService(withLegacy());
      await expect(service.checkoutCart(userId)).rejects.toMatchObject({
        response: { code: 'PERKS_MEMBERSHIP_REQUIRED' },
      });
    });

    it('shows the dashboard as not_registered', async () => {
      const { service } = createService(withLegacy());
      const dashboard = await service.getDashboard(userId);
      expect(dashboard.membership).toMatchObject({ status: 'not_registered' });
    });
  });

  describe('membership gating', () => {
    const blocked = (status: PerksMembershipStatus) => ({
      membershipModel: {
        findOne: jest.fn(() => {
          const doc = membershipDoc({ status });
          doc.lean = jest.fn().mockResolvedValue({ ...doc });
          return doc;
        }),
      },
    });

    it('blocks checkout for a cancelled member', async () => {
      const { service } = createService(blocked(PerksMembershipStatus.CANCELLED));
      await expect(service.checkoutCart(userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('blocks adding to cart without an active membership', async () => {
      const { service } = createService(blocked(PerksMembershipStatus.PENDING));
      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 50,
          quantity: 1,
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cart', () => {
    it('merges a repeat add into the existing line', async () => {
      const { service, cart } = createService();
      await service.addCartItem(userId, {
        ecardId: '1',
        ecardValue: 50,
        quantity: 1,
      } as never);
      await service.addCartItem(userId, {
        ecardId: '1',
        ecardValue: 50,
        quantity: 2,
      } as never);

      expect(cart.items).toHaveLength(1);
      expect((cart.items as never[])[0]).toMatchObject({ quantity: 3 });
    });

    it('rejects a denomination the card does not offer', async () => {
      const { service } = createService();
      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 77,
          quantity: 1,
        } as never),
      ).rejects.toThrow(/not available/i);
    });

    it('refuses a card WeMAD has not priced instead of guessing an amount', async () => {
      const { service } = createService({
        api: {
          getGiftCard: jest.fn().mockResolvedValue({
            gift_card: { ...CARD, provider_product: undefined },
          }),
        },
      });

      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 50,
          quantity: 1,
        } as never),
      ).rejects.toThrow(/not available to buy yet/i);
    });

    it.each([
      ['a denomination the fixed card does not offer', 37.5],
      ['zero', 0],
      ['a negative amount', -50],
    ])('rejects %s', async (_label, value) => {
      const { service } = createService();
      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: value,
          quantity: 1,
        } as never),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('rejects an amount above a variable card maximum', async () => {
      const variableCard = {
        ...CARD,
        provider_product: {
          price_type: 'variable',
          min_amount: '10.00',
          max_amount: '100.00',
          available_denominations: [],
        },
      };
      const { service } = createService({
        api: {
          getGiftCard: jest.fn().mockResolvedValue({ gift_card: variableCard }),
        },
      });

      await expect(
        service.addCartItem(userId, {
          ecardId: '3',
          ecardValue: 5000,
          quantity: 1,
        } as never),
      ).rejects.toMatchObject({ status: 422 });
    });

    // WeMAD's cart accepts any amount, so these bounds exist only here.
    it('enforces min/max on variable-price cards', async () => {
      const variableCard = {
        ...CARD,
        provider_product: {
          price_type: 'variable',
          min_amount: '10.00',
          max_amount: '100.00',
          available_denominations: [],
        },
      };
      const { service } = createService({
        api: {
          listAllGiftCards: jest.fn().mockResolvedValue([variableCard]),
          getGiftCard: jest.fn().mockResolvedValue({ gift_card: variableCard }),
        },
      });

      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 999,
          quantity: 1,
        } as never),
      ).rejects.toThrow(/between \$10 and \$100/);

      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 50,
          quantity: 1,
        } as never),
      ).resolves.toBeDefined();
    });

    it('rejects a zero or negative amount', async () => {
      const { service } = createService();
      await expect(
        service.addCartItem(userId, {
          ecardId: '1',
          ecardValue: 0,
          quantity: 1,
        } as never),
      ).rejects.toThrow(/valid amount/i);
    });

  
    it('quotes against the detail card, not the listing fallback ladder', async () => {
      const listingCard = { ...CARD, provider_product: undefined };
      const detailCard = {
        ...CARD,
        provider_product: {
          price_type: 'fixed',
          available_denominations: [{ amount: '1000.00' }],
        },
      };
      const { service, api } = createService({
        api: {
          listAllGiftCards: jest.fn().mockResolvedValue([listingCard]),
          getGiftCard: jest.fn().mockResolvedValue({ gift_card: detailCard }),
        },
      });

      await service.addCartItem(userId, {
        ecardId: '1',
        ecardValue: 1000,
        quantity: 1,
      } as never);

      const quote = await service.quoteCart(userId);
      expect(quote.items[0].faceValueCents).toBe(100000);
      expect(api.getGiftCard).toHaveBeenCalled();
    });

    it('quotes using the card discount and per-unit delivery fee', async () => {
      const { service } = createService();
      const quote = await service.quote({
        ecardId: '1',
        ecardValue: 50,
        quantity: 2,
      } as never);
      expect(quote.totals).toMatchObject({
        faceValueCents: 10000,
        purchasePriceCents: 9000,
        deliveryFeeCents: 200,
        totalCents: 9200,
      });
    });
  });

  describe('checkout', () => {
    const cartWithItems = () =>
      cartDoc([
        {
          itemId: 'a',
          ecardId: '1',
          quantity: 3,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
      ]);

    it('expands quantity into one upstream row per unit', async () => {
      const cart = cartWithItems();
      const { service, api } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
      });

      await service.checkoutCart(userId);

      expect(api.addToCart).toHaveBeenCalledTimes(3);
      expect(api.addToCart).toHaveBeenCalledWith(
        'access-1',
        expect.objectContaining({
          gift_card_id: '1',
          amount: 50,
          purchase_type: 'self',
        }),
      );
    });

    it('clears stale upstream rows before syncing', async () => {
      const cart = cartWithItems();
      let upstream: Record<string, unknown>[] = [{ id: 40 }, { id: 41 }];
      const { service, api } = createService({
        cartModel: { findOne: jest.fn(() => cart), updateOne: jest.fn() },
        api: {
          getCart: jest.fn(async () => [...upstream]),
          removeFromCart: jest.fn(async (_t: string, id: number | string) => {
            upstream = upstream.filter(row => row.id !== id);
          }),
          addToCart: jest.fn(async () => {
            upstream.push({ id: 100 + upstream.length });
          }),
        },
      });

      await service.checkoutCart(userId);
      expect(api.removeFromCart).toHaveBeenCalledWith('access-1', 40);
      expect(api.removeFromCart).toHaveBeenCalledWith('access-1', 41);
      expect(upstream).toHaveLength(3);
    });

    it('mints a fresh web token per checkout — they are single-use', async () => {
      const cart = cartWithItems();
      const { service, session } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
      });

      const first = await service.checkoutCart(userId);
      expect(first.status).toBe('redirect');
      expect(first.checkoutUrl).toContain('web-fresh');

      session.login.mockResolvedValue({
        accessToken: 'access-2',
        webToken: 'web-second',
        wmadUserId: '119',
      });
      const second = await service.checkoutCart(userId);

      expect(session.login).toHaveBeenCalledTimes(2);
      expect(second.checkoutUrl).toContain('web-second');
    });

    it('sends every field WeMAD requires on a gift line', async () => {
      // Verified live: a gift line missing recipient_phone or
      // gift_template_design_id is rejected 422, which previously surfaced as a
      // failed checkout after the customer had filled the whole form in.
      const cart = cartDoc([
        {
          itemId: 'g',
          ecardId: '3',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: true,
          gift: {
            recipientName: 'John Doe',
            recipientEmail: 'john@example.com',
            recipientPhone: '0400000000',
            templateId: '2',
            templateDesignId: '4',
            message: 'Happy Birthday!',
          },
        },
      ]);
      const { service, api } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
      });

      await service.checkoutCart(userId);

      expect(api.addToCart).toHaveBeenCalledWith(
        'access-1',
        expect.objectContaining({
          purchase_type: 'gift',
          recipient_name: 'John Doe',
          recipient_email: 'john@example.com',
          // Stored with its trunk zero before the nine-digit rule existed;
          // normalised on the way out so old carts still check out.
          recipient_phone: '400000000',
          gift_template_id: '2',
          gift_template_design_id: '4',
          message: 'Happy Birthday!',
        }),
      );
    });

    it('sends gift metadata for gifted lines', async () => {
      const cart = cartDoc([
        {
          itemId: 'b',
          ecardId: '1',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: true,
          gift: {
            recipientName: 'John Doe',
            recipientEmail: 'john@example.com',
            templateId: '2',
          },
        },
      ]);
      const { service, api } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
      });

      await service.checkoutCart(userId);
      expect(api.addToCart).toHaveBeenCalledWith(
        'access-1',
        expect.objectContaining({
          purchase_type: 'gift',
          recipient_name: 'John Doe',
          recipient_email: 'john@example.com',
          gift_template_id: '2',
        }),
      );
    });

    it('fails loudly when the upstream cart did not receive the items', async () => {
      const cart = cartWithItems(); 
      const { service } = createService({
        cartModel: { findOne: jest.fn(() => cart), updateOne: jest.fn() },
        api: {
          getCart: jest.fn().mockResolvedValue([]),
          addToCart: jest.fn().mockResolvedValue(undefined),
        },
      });

      await expect(service.checkoutCart(userId)).rejects.toMatchObject({
        response: { code: 'PERKS_CART_SYNC_FAILED' },
      });
    });

    it('proceeds when every unit reached the upstream cart', async () => {
      const cart = cartWithItems(); 
      let added = 0;
      const { service } = createService({
        cartModel: { findOne: jest.fn(() => cart), updateOne: jest.fn() },
        api: {
          addToCart: jest.fn(async () => {
            added += 1;
          }),
          getCart: jest.fn(async () =>
            added === 0 ? [] : Array.from({ length: added }, (_, i) => ({ id: i + 1 })),
          ),
        },
      });

      await expect(service.checkoutCart(userId)).resolves.toMatchObject({
        status: 'redirect',
      });
    });

    it('refuses to check out an empty cart', async () => {
      const { service } = createService();
      await expect(service.checkoutCart(userId)).rejects.toThrow(
        /cart is empty/i,
      );
    });
  });

  describe('orders', () => {
    it('maps and paginates the upstream order list', async () => {
      const { service } = createService({
        api: {
          listOrders: jest.fn().mockResolvedValue([
            {
              id: 1,
              order_number: '0001',
              order_reference: 'REF-1',
              status: 'processing',
              subtotal: '50.00',
              grand_total: '46.00',
              order_item: [],
            },
          ]),
        },
      });

      const result = await service.listOrders(userId, { limit: 20, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({ orderNumber: '0001' });
    });

    it('labels order lines with the card name and artwork', async () => {
      // What a customer sees after paying. Previously this depended on the
      // whole 634-card catalogue loading; when that failed every purchased card
      // rendered as "Gift card" with no image.
      const { service } = createService({
        api: {
          listOrders: jest.fn().mockResolvedValue([
            {
              id: 1,
              order_number: '0001',
              status: 'processing',
              order_item: [
                { id: 9, gift_card_id: '1', amount: '50.00', status: 'processing' },
              ],
            },
          ]),
        },
      });

      const result = await service.listOrders(userId, { limit: 20, offset: 0 });
      expect(result.items[0].lines[0]).toMatchObject({
        ecardName: 'Coles Gift Card',
        ecardImageUrl: 'https://admin.wemad.com.au/storage/giftcards/3.jpg',
      });
    });

    it('still lists the order when a card cannot be resolved', async () => {
      const { service } = createService({
        api: {
          listOrders: jest.fn().mockResolvedValue([
            {
              id: 1,
              order_number: '0001',
              order_item: [{ id: 9, gift_card_id: '999', amount: '50.00' }],
            },
          ]),
          getGiftCard: jest.fn().mockRejectedValue(new Error('not found')),
        },
      });

      const result = await service.listOrders(userId, { limit: 20, offset: 0 });
      expect(result.items[0].lines[0].ecardName).toBe('Gift card');
    });

    it('finds a single order by number or reference', async () => {
      const orders = {
        listOrders: jest.fn().mockResolvedValue([
          {
            id: 1,
            order_number: '0001',
            order_reference: 'REF-1',
            order_item: [],
          },
        ]),
      };
      const { service } = createService({ api: orders });

      await expect(service.getOrder(userId, '0001')).resolves.toMatchObject({
        orderNumber: '0001',
      });
      await expect(service.getOrder(userId, 'REF-1')).resolves.toMatchObject({
        orderReference: 'REF-1',
      });
      await expect(service.getOrder(userId, 'nope')).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('expired upstream token', () => {
    const expiredThenOk = (method: 'listOrders' | 'listMyGiftCards', ok: unknown) => {
      let calls = 0;
      return jest.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new PerksCorpApiError('Unauthenticated', 401, 'INVALID_TOKEN', false, false);
        }
        return ok;
      });
    };

    const retryingSession = () => ({
      withAccessToken: jest.fn(
        async (_u: string, _user: unknown, run: (t: string) => Promise<unknown>) => {
          try {
            return await run('stale-token');
          } catch (error) {
            if (
              error instanceof PerksCorpApiError &&
              error.statusCode === 401
            ) {
              return run('fresh-token');
            }
            throw error;
          }
        },
      ),
    });

    it('refreshes the token and retries orders', async () => {
      const listOrders = expiredThenOk('listOrders', { orders: { data: [] } });
      const { service } = createService({
        api: { listOrders },
        session: retryingSession(),
      });

      await expect(
        service.listOrders(userId, { limit: 20, offset: 0 } as never),
      ).resolves.toMatchObject({ total: 0 });
      expect(listOrders).toHaveBeenCalledTimes(2);
      expect(listOrders).toHaveBeenNthCalledWith(1, 'stale-token');
      expect(listOrders).toHaveBeenNthCalledWith(2, 'fresh-token');
    });

    it('refreshes the token and retries the wallet', async () => {
      const listMyGiftCards = expiredThenOk('listMyGiftCards', []);
      const { service } = createService({
        api: { listMyGiftCards },
        session: retryingSession(),
      });

      await expect(service.getWallet(userId, false, 'active')).resolves.toEqual([]);
      expect(listMyGiftCards).toHaveBeenCalledTimes(2);
    });

    it('surfaces a 401 that survives the retry', async () => {
      const alwaysExpired = jest.fn(async () => {
        throw new PerksCorpApiError('Unauthenticated', 401, 'INVALID_TOKEN', false, false);
      });
      const { service } = createService({
        api: { listOrders: alwaysExpired },
        session: retryingSession(),
      });

      await expect(
        service.listOrders(userId, { limit: 20, offset: 0 } as never),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('wallet', () => {
    it('splits owned from gifted cards', async () => {
      const { service } = createService({
        api: {
          listMyGiftCards: jest.fn().mockResolvedValue([
            { gift_card_name: 'Coles', amount: '50', purchase_type: 'self' },
            { gift_card_name: 'Kmart', amount: '20', purchase_type: 'gift' },
          ]),
        },
      });

      const owned = await service.getWallet(userId, false, 'active');
      const gifted = await service.getWallet(userId, true, 'active');
      expect(owned.map((c) => c.cardName)).toEqual(['Coles']);
      expect(gifted.map((c) => c.cardName)).toEqual(['Kmart']);
    });

    it('looks up a single card with one upstream call, not four', async () => {
      const listMyGiftCards = jest.fn().mockResolvedValue([
        { gift_card_name: 'Coles', amount: '50', purchase_type: 'self' },
      ]);
      const { service } = createService({ api: { listMyGiftCards } });

      const [card] = await service.getWallet(userId, false, 'active');
      listMyGiftCards.mockClear();

      await expect(
        service.getWalletCard(userId, card.cardKey),
      ).resolves.toMatchObject({ cardName: 'Coles' });
      expect(listMyGiftCards).toHaveBeenCalledTimes(1);
    });

    it('keeps a card archived after WeMAD issues it', async () => {
      // The reported bug: archive a processing card, WeMAD issues it and adds a
      // voucher code, the old key changed and the card jumped back to Active.
      const processing = [
        {
          id: 9,
          order_number: '0001',
          gift_card_id: '1',
          amount: '50',
          purchase_type: 'self',
          status: 'processing',
        },
      ];
      const issued = [
        { ...processing[0], status: 'sent', card_number: '627123456' },
      ];

      const { service: before } = createService({
        api: { listMyGiftCards: jest.fn().mockResolvedValue(processing) },
      });
      const [card] = await before.getWallet(userId, false, 'active');

      const { service: after } = createService({
        api: { listMyGiftCards: jest.fn().mockResolvedValue(issued) },
        walletMetadataModel: {
          find: jest.fn(() =>
            lean([{ cardKey: card.cardKey, archived: true, hidden: false }]),
          ),
        },
      });

      const archived = await after.getWallet(userId, false, 'archived');
      expect(archived).toHaveLength(1);
      expect(await after.getWallet(userId, false, 'active')).toEqual([]);
    });

    it('finds archive state saved under the old volatile key and migrates it', async () => {
      const entries = [
        {
          id: 9,
          order_number: '0001',
          gift_card_id: '1',
          gift_card_name: 'Coles',
          amount: '50',
          purchase_type: 'self',
          created_at: '2026-08-21T07:00:00Z',
          card_number: '627123456',
        },
      ];
      // Exactly what an existing row in Mongo looks like.
      const legacyKey = legacyWalletCardKey(entries[0], false);
      const bulkWrite = jest.fn().mockResolvedValue({});

      const { service } = createService({
        api: { listMyGiftCards: jest.fn().mockResolvedValue(entries) },
        walletMetadataModel: {
          find: jest.fn(() =>
            lean([{ cardKey: legacyKey, archived: true, hidden: false }]),
          ),
          bulkWrite,
        },
      });

      const archived = await service.getWallet(userId, false, 'archived');
      expect(archived).toHaveLength(1);
      // And the row is moved onto the stable key so the repair is one-off.
      expect(bulkWrite).toHaveBeenCalled();
    });

    it('applies local archive and hide state over the upstream list', async () => {
      const entries = [
        { gift_card_name: 'Coles', amount: '50', purchase_type: 'self' },
        { gift_card_name: 'Kmart', amount: '20', purchase_type: 'self' },
      ];
      const { service: plain } = createService({
        api: { listMyGiftCards: jest.fn().mockResolvedValue(entries) },
      });
      const [coles, kmart] = await plain.getWallet(userId, false, 'active');

      const { service } = createService({
        api: { listMyGiftCards: jest.fn().mockResolvedValue(entries) },
        walletMetadataModel: {
          find: jest.fn(() =>
            lean([
              { cardKey: coles.cardKey, archived: true, hidden: false },
              { cardKey: kmart.cardKey, archived: false, hidden: true },
            ]),
          ),
        },
      });

      await expect(service.getWallet(userId, false, 'active')).resolves.toEqual(
        [],
      );
      const archived = await service.getWallet(userId, false, 'archived');
      expect(archived.map((c) => c.cardName)).toEqual(['Coles']);

      expect(archived.some((c) => c.cardName === 'Kmart')).toBe(false);
    });

    it('returns a null receipt while WeMAD has no invoice link yet', async () => {
      const { service } = createService({
        api: {
          listOrders: jest
            .fn()
            .mockResolvedValue([
              { id: 1, order_number: '0001', order_item: [] },
            ]),
        },
      });
      await expect(service.getTaxReceipt(userId, '0001')).resolves.toEqual({
        orderNumber: '0001',
        receiptUrl: null,
      });
    });

    it('returns the invoice link as soon as the order carries one', async () => {
      const { service } = createService({
        api: {
          listOrders: jest.fn().mockResolvedValue([
            {
              id: 1,
              order_number: '0001',
              invoice_url: 'https://sandbox.wemad.com.au/invoice/1.pdf',
              order_item: [],
            },
          ]),
        },
      });
      await expect(service.getTaxReceipt(userId, '0001')).resolves.toMatchObject({
        receiptUrl: 'https://sandbox.wemad.com.au/invoice/1.pdf',
      });
    });
  });

  describe('calculator', () => {
    it('computes annual savings per category', () => {
      const { service } = createService();
      const result = service.calculate({
        items: [
          {
            category: 'groceries',
            amount: 100,
            frequency: PerksSpendFrequency.WEEKLY,
          },
        ],
      });
      expect(result.totals.annual).toBe(234);
    });

    it('resolves legacy category aliases', () => {
      const { service } = createService();
      expect(
        service.calculate({
          items: [
            {
              category: 'petrol',
              amount: 100,
              frequency: PerksSpendFrequency.ANNUALLY,
            },
          ],
        }).items[0].categoryKey,
      ).toBe('fuel');
    });
  });
});
