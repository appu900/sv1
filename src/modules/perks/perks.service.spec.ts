import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../database/schemas/perks-membership.schema';
import { PerksCartStatus } from '../../database/schemas/perks-cart.schema';
import { PerksSpendFrequency } from './dto/perks.dto';
import { PerksService } from './perks.service';

const userId = new Types.ObjectId().toString();

const lean = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });

const CARD = {
  id: 1,
  name: 'Coles Gift Card',
  image: 'giftcards/3.jpg',
  delivery_fee: '1.00',
  per_standard: '0.00',
  per_gold: '10.00',
  is_popular: 0,
  categories: [{ id: 14, parent_id: 10, slug: 'groceries', name: 'Groceries' }],
  provider_product: {
    price_type: 'fixed',
    available_denominations: [{ amount: '50.00' }, { amount: '100.00' }],
  },
};

/** Mongoose doc stand-in: supports both `.lean()` and document mutation. */
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
  const api = {
    listGiftCards: jest.fn().mockResolvedValue([CARD]),
    getGiftCard: jest.fn().mockResolvedValue({ gift_card: CARD }),
    getCart: jest.fn().mockResolvedValue([]),
    addToCart: jest.fn().mockResolvedValue(undefined),
    removeFromCart: jest.fn().mockResolvedValue(undefined),
    listOrders: jest.fn().mockResolvedValue({ orders: { data: [] } }),
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
  };

  Object.assign(api, overrides.api);
  Object.assign(session, overrides.session);
  Object.assign(membershipModel, overrides.membershipModel);
  Object.assign(cartModel, overrides.cartModel);
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
      redis as never,
      config as never,
    ),
    api,
    session,
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
      expect(api.listGiftCards).toHaveBeenCalledTimes(1);
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
      expect(api.listGiftCards).toHaveBeenCalled();
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
          listGiftCards: jest.fn().mockResolvedValue([variableCard]),
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
          listGiftCards: jest.fn().mockResolvedValue([listingCard]),
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

      // 10% off $50 = $45/unit, ×2 = $90, plus $1 delivery per unit.
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
      const { service, api } = createService({
        cartModel: {
          findOne: jest.fn().mockResolvedValue(cart),
          updateOne: jest.fn(),
        },
        api: { getCart: jest.fn().mockResolvedValue([{ id: 40 }, { id: 41 }]) },
      });

      await service.checkoutCart(userId);
      expect(api.removeFromCart).toHaveBeenCalledWith('access-1', 40);
      expect(api.removeFromCart).toHaveBeenCalledWith('access-1', 41);
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

    it('refuses to check out an empty cart', async () => {
      const { service } = createService();
      await expect(service.checkoutCart(userId)).rejects.toThrow(
        /cart with items/i,
      );
    });
  });

  describe('orders', () => {
    it('maps and paginates the upstream order list', async () => {
      const { service } = createService({
        api: {
          listOrders: jest.fn().mockResolvedValue({
            orders: {
              data: [
                {
                  id: 1,
                  order_number: '0001',
                  order_reference: 'REF-1',
                  status: 'processing',
                  subtotal: '50.00',
                  grand_total: '46.00',
                  order_item: [],
                },
              ],
            },
          }),
        },
      });

      const result = await service.listOrders(userId, { limit: 20, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({ orderNumber: '0001' });
    });

    it('finds a single order by number or reference', async () => {
      const orders = {
        listOrders: jest.fn().mockResolvedValue({
          orders: {
            data: [
              {
                id: 1,
                order_number: '0001',
                order_reference: 'REF-1',
                order_item: [],
              },
            ],
          },
        }),
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

    it('returns a null receipt rather than failing — no corp equivalent', async () => {
      const { service } = createService();
      await expect(service.getTaxReceipt(userId, '0001')).resolves.toEqual({
        orderNumber: '0001',
        receiptUrl: null,
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
