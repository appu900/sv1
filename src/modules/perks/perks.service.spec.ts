import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PerksMembershipStatus } from '../../database/schemas/perks-membership.schema';
import { PerksOrderStatus } from '../../database/schemas/perks-order.schema';
import { PerksApiError } from './perks-api-client';
import { PerksSpendFrequency } from './dto/perks.dto';
import { PerksService } from './perks.service';

const userId = new Types.ObjectId().toString();

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function createService(overrides: Record<string, unknown> = {}) {
  const userModel = {
    findById: jest.fn(() =>
      lean({
        _id: userId,
        name: 'Saveful Tester',
        email: 'tester@saveful.com',
        pincode: '5000',
      }),
    ),
  };
  const membershipModel = {
    findOne: jest.fn(() => lean(null)),
    findOneAndUpdate: jest.fn(),
  };
  const orderModel = {
    findOne: jest.fn(() => lean(null)),
    create: jest.fn(),
    find: jest.fn(),
  };
  const favouriteModel = {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
  };
  const cartModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  };
  const walletMetadataModel = {
    find: jest.fn(() => lean([])),
    findOneAndUpdate: jest.fn(),
  };
  const calculatorProfileModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const cache = new Map<string, unknown>();
  const locks = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    setIfAbsent: jest.fn(
      async (key: string, value: string): Promise<boolean> => {
        if (locks.has(key)) return false;
        locks.set(key, value);
        return true;
      },
    ),
    releaseLock: jest.fn(
      async (key: string, value: string): Promise<boolean> => {
        if (locks.get(key) !== value) return false;
        locks.delete(key);
        return true;
      },
    ),
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'PERKS_ORDER_ISSUANCE_ENABLED' ? 'true' : fallback,
    ),
  };
  const api = {
    registerUser: jest.fn(),
    getEcards: jest.fn().mockResolvedValue([]),
    getGiftOptions: jest.fn(),
    createOrder: jest.fn(),
    getOrderDetail: jest.fn(),
    cancelOrder: jest.fn(),
    getTaxReceipt: jest.fn(),
    getWallet: jest.fn(),
    getGiftedWallet: jest.fn(),
  };
  Object.assign(api, overrides.api);
  Object.assign(userModel, overrides.userModel);
  Object.assign(membershipModel, overrides.membershipModel);
  Object.assign(orderModel, overrides.orderModel);
  Object.assign(favouriteModel, overrides.favouriteModel);
  Object.assign(cartModel, overrides.cartModel);
  Object.assign(walletMetadataModel, overrides.walletMetadataModel);
  Object.assign(calculatorProfileModel, overrides.calculatorProfileModel);
  Object.assign(redis, overrides.redis);
  Object.assign(config, overrides.config);

  return {
    service: new PerksService(
      userModel as never,
      membershipModel as never,
      orderModel as never,
      favouriteModel as never,
      cartModel as never,
      walletMetadataModel as never,
      calculatorProfileModel as never,
      api as never,
      redis as never,
      config as never,
    ),
    userModel,
    membershipModel,
    orderModel,
    favouriteModel,
    cartModel,
    walletMetadataModel,
    calculatorProfileModel,
    api,
    redis,
    config,
  };
}

describe('PerksService', () => {
  it('calculates weekly, monthly, and annual savings in cents', () => {
    const { service } = createService();
    const result = service.calculate({
      items: [
        {
          category: 'groceries',
          amount: 100,
          frequency: PerksSpendFrequency.WEEKLY,
        },
        {
          category: 'travel',
          amount: 1200,
          frequency: PerksSpendFrequency.ANNUALLY,
        },
      ],
    });

    expect(result.items[0]).toMatchObject({
      category: 'Groceries',
      annualSpend: 5200,
      savings: { annual: 234, monthly: 19.5, weekly: 4.5 },
    });
    expect(result.totals).toEqual({
      annual: 354,
      monthly: 29.5,
      weekly: 6.81,
    });
  });

  it('accepts the savings-calculator category keys and legacy aliases', () => {
    const { service } = createService();
    const result = service.calculate({
      items: [
        {
          category: 'pharmacy',
          amount: 140,
          frequency: PerksSpendFrequency.MONTHLY,
        },
        {
          category: 'dining',
          amount: 450,
          frequency: PerksSpendFrequency.MONTHLY,
        },
        {
          category: 'fashion',
          amount: 220,
          frequency: PerksSpendFrequency.MONTHLY,
        },
        {
          category: 'eats-drinks',
          amount: 100,
          frequency: PerksSpendFrequency.MONTHLY,
        },
        {
          category: 'clothes-fashion',
          amount: 100,
          frequency: PerksSpendFrequency.MONTHLY,
        },
      ],
    });

    expect(result.items.map(item => item.categoryKey)).toEqual([
      'pharmacy',
      'dining',
      'fashion',
      'dining',
      'fashion',
    ]);
    expect(service.getCalculatorCategories()).toHaveLength(9);
  });

  it('requires a first name, last name, and numeric postcode', async () => {
    const { service } = createService({
      userModel: {
        findById: jest.fn(() =>
          lean({
            _id: userId,
            name: 'Cher',
            email: 'cher@example.com',
            pincode: '',
          }),
        ),
      },
    });

    try {
      await service.ensureMembership(userId);
      throw new Error('Expected profile validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        missingFields: ['name', 'pincode'],
      });
    }
  });

  it('requires at least four digits in the stored pincode', async () => {
    const { service } = createService({
      userModel: {
        findById: jest.fn(() =>
          lean({
            _id: userId,
            name: 'Short Postcode',
            email: 'short@example.com',
            pincode: '123',
          }),
        ),
      },
    });

    await expect(service.ensureMembership(userId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('trims longer stored pincodes before registering with WMAD', async () => {
    const membership = {
      wmadUserId: null,
      status: PerksMembershipStatus.PENDING,
      registeredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service, api, membershipModel } = createService({
      userModel: {
        findById: jest.fn(() =>
          lean({
            _id: userId,
            name: 'Long Postcode',
            email: 'long@example.com',
            pincode: '123456',
          }),
        ),
      },
      membershipModel: {
        findOneAndUpdate: jest.fn().mockResolvedValue(membership),
      },
      api: {
        registerUser: jest.fn().mockResolvedValue({ user_id: 10625 }),
      },
    });

    await expect(service.ensureMembership(userId)).resolves.toMatchObject({
      wmadUserId: '10625',
      status: PerksMembershipStatus.ACTIVE,
    });
    expect(api.registerUser).toHaveBeenCalledWith({
      firstname: 'Long',
      lastname: 'Postcode',
      email: 'long@example.com',
      postcode: '1234',
    });
    expect(membershipModel.findOneAndUpdate).toHaveBeenCalled();
    expect(membership.save).toHaveBeenCalled();
  });

  it('reads membership status without registering or calling WMAD', async () => {
    const { service, api } = createService({
      membershipModel: {
        findOne: jest.fn(() => lean(null)),
      },
    });

    await expect(service.getMembershipStatus(userId)).resolves.toEqual({
      wmadUserId: null,
      status: 'not_registered',
      registeredAt: null,
      missingFields: [],
    });
    expect(api.registerUser).not.toHaveBeenCalled();
  });

  it('registers a Saveful user once and stores the WMAD identity', async () => {
    const membership = {
      wmadUserId: null,
      status: PerksMembershipStatus.PENDING,
      registeredAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service, membershipModel, api } = createService({
      membershipModel: {
        findOneAndUpdate: jest.fn().mockResolvedValue(membership),
      },
      api: {
        registerUser: jest.fn().mockResolvedValue({ user_id: 10625 }),
      },
    });

    await expect(service.ensureMembership(userId)).resolves.toMatchObject({
      wmadUserId: '10625',
      status: PerksMembershipStatus.ACTIVE,
    });
    expect(api.registerUser).toHaveBeenCalledWith({
      firstname: 'Saveful',
      lastname: 'Tester',
      email: 'tester@saveful.com',
      postcode: '5000',
    });
    expect(membershipModel.findOneAndUpdate).toHaveBeenCalled();
    expect(membership.save).toHaveBeenCalled();
  });

  it('normalizes card values and rejects unsafe image paths', async () => {
    const { service } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Safe card',
            ecard_image: '340.png',
            ecard_price: '50,100',
          },
          {
            ecard_id: '341',
            ecard_name: 'Unsafe card',
            ecard_image: '../secret.png',
            ecard_price: '25',
          },
        ]),
      },
    });

    const cards = await service.getEcards(userId);
    expect(cards[0]).toMatchObject({
      id: '340',
      availableValues: [50, 100],
      imageUrl: 'https://www.wemad.com.au/upload/ecards/340.png',
    });
    expect(cards[1].imageUrl).toBeNull();
  });

  it('returns a completed idempotent order without purchasing twice', async () => {
    const existing = {
      orderReference: 'SVREF',
      wmadOrderNumber: '123',
      requestHash: '',
      status: PerksOrderStatus.COMPLETED,
    };
    const dto = { ecardId: '340', ecardValue: 50, quantity: 1 };
    const { createHash } = await import('crypto');
    existing.requestHash = createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');
    const { service, api } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      orderModel: {
        findOne: jest.fn(() => lean(existing)),
      },
    });

    await expect(
      service.createOrder(userId, 'checkout_123', dto),
    ).resolves.toMatchObject({
      orderNumber: '123',
      status: PerksOrderStatus.COMPLETED,
    });
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with another payload', async () => {
    const { service } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      orderModel: {
        findOne: jest.fn(() =>
          lean({
            orderReference: 'SVREF',
            requestHash: 'different',
            status: PerksOrderStatus.COMPLETED,
          }),
        ),
      },
    });

    await expect(
      service.createOrder(userId, 'checkout_123', {
        ecardId: '340',
        ecardValue: 50,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks a timed-out purchase as unknown instead of retrying', async () => {
    const order = {
      orderReference: 'SVREF',
      wmadOrderNumber: null,
      status: PerksOrderStatus.STARTED,
      lines: [],
      lastErrorCode: null,
      lastErrorMessage: null,
      save: jest.fn(),
    };
    const { service } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      orderModel: {
        create: jest.fn().mockResolvedValue(order),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Test card',
            ecard_price: '50',
            discount: 5,
          },
        ]),
        createOrder: jest
          .fn()
          .mockRejectedValue(
            new PerksApiError('timed out', 503, 'UPSTREAM_TIMEOUT', true, true),
          ),
      },
    });

    await expect(
      service.createOrder(userId, 'checkout_123', {
        ecardId: '340',
        ecardValue: 50,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(order.status).toBe(PerksOrderStatus.UNKNOWN);
    expect(order.save).toHaveBeenCalled();
  });

  it('never calls WMAD when order issuance is disabled', async () => {
    const { service, api } = createService({
      config: {
        get: jest.fn((key: string, fallback: unknown) =>
          key === 'PERKS_ORDER_ISSUANCE_ENABLED' ? 'false' : fallback,
        ),
      },
    });

    await expect(
      service.createOrder(userId, 'checkout_123', {
        ecardId: '340',
        ecardValue: 50,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(api.registerUser).not.toHaveBeenCalled();
    expect(api.getEcards).not.toHaveBeenCalled();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it('returns a payment-required quote without WMAD calls when issuance is disabled', async () => {
    const cart = {
      status: 'active',
      items: [
        {
          itemId: 'line-a',
          ecardId: '340',
          quantity: 2,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
      ],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service, api } = createService({
      config: {
        get: jest.fn((key: string, fallback: unknown) =>
          key === 'PERKS_ORDER_ISSUANCE_ENABLED' ? 'false' : fallback,
        ),
      },
      cartModel: {
        findOne: jest.fn().mockResolvedValue(cart),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Test card',
            ecard_price: '50',
            discount: 5,
          },
        ]),
      },
    });

    await expect(
      service.checkoutCart(userId, 'checkout_123'),
    ).resolves.toMatchObject({
      status: 'payment_required',
      issuanceEnabled: false,
      quote: {
        totals: {
          faceValueCents: 10000,
          purchasePriceCents: 9500,
          totalCents: 9500,
        },
      },
    });
    expect(api.registerUser).not.toHaveBeenCalled();
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(cart.status).toBe('active');
  });

  it('persists and issues checkout lines one at a time', async () => {
    const cart = {
      _id: new Types.ObjectId(),
      status: 'active',
      checkoutIdempotencyKey: null,
      orderId: null,
      checkedOutAt: null,
      items: [
        {
          itemId: 'line-a',
          ecardId: '340',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
        {
          itemId: 'line-b',
          ecardId: '341',
          quantity: 2,
          faceValueCents: 2500,
          sendAsGift: false,
          gift: null,
        },
      ],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    let order: Record<string, any>;
    const { service, api } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      cartModel: {
        findOneAndUpdate: jest.fn().mockResolvedValue(cart),
      },
      orderModel: {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (payload: Record<string, unknown>) => {
          order = {
            ...payload,
            _id: new Types.ObjectId(),
            lastErrorCode: null,
            lastErrorMessage: null,
            completedAt: null,
            save: jest.fn(),
            toObject() {
              return this;
            },
          };
          return order;
        }),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Card A',
            ecard_price: '50',
            discount: 5,
          },
          {
            ecard_id: '341',
            ecard_name: 'Card B',
            ecard_price: '25',
            discount: 10,
          },
        ]),
        createOrder: jest
          .fn()
          .mockResolvedValueOnce({
            order_number: '1001',
            order_status: 2,
          })
          .mockResolvedValueOnce({
            order_number: '1002',
            order_status: 2,
          }),
      },
    });

    await expect(
      service.checkoutCart(userId, 'checkout_lines_123'),
    ).resolves.toMatchObject({
      status: PerksOrderStatus.COMPLETED,
      lines: [
        { orderNumber: '1001', status: PerksOrderStatus.COMPLETED },
        { orderNumber: '1002', status: PerksOrderStatus.COMPLETED },
      ],
    });
    expect(api.createOrder).toHaveBeenCalledTimes(2);
    expect(order!.save).toHaveBeenCalledTimes(3);
    expect(cart.status).toBe('checked_out');
  });

  it('caches and filters the normalized catalogue', async () => {
    const { service, api, redis } = createService({
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '1',
            ecard_name: 'Grocer',
            ecard_category: 'Groceries',
            ecard_price: '25,50',
            discount: '4.5',
            ecard_featured: '1',
            ecard_desc: 'Long catalogue description',
            ecard_term: 'Long catalogue terms',
          },
          {
            ecard_id: '2',
            ecard_name: 'Travel',
            ecard_category: 'Travel',
            ecard_price: '100',
            discount: '10',
          },
        ]),
      },
    });

    const summaries = await service.getCatalogue({
      q: 'gro',
      featured: true,
    });
    expect(summaries).toEqual([
      expect.objectContaining({
        id: '1',
        category: 'Groceries',
        discountPercent: 4.5,
      }),
    ]);
    expect(summaries[0]).not.toHaveProperty('description');
    expect(summaries[0]).not.toHaveProperty('terms');

    await expect(service.getCatalogueCard('1')).resolves.toMatchObject({
      description: 'Long catalogue description',
      terms: 'Long catalogue terms',
    });
    await expect(
      service.getCatalogue({ q: 'gro', featured: true }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: '1',
        category: 'Groceries',
        discountPercent: 4.5,
      }),
    ]);
    await service.getCatalogue({});
    expect(api.getEcards).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent catalogue misses inside one API instance', async () => {
    let resolveCards!: (cards: Record<string, unknown>[]) => void;
    const upstream = new Promise<Record<string, unknown>[]>((resolve) => {
      resolveCards = resolve;
    });
    const { service, api } = createService({
      api: {
        getEcards: jest.fn(() => upstream),
      },
    });

    const listRequest = service.getCatalogue({});
    const detailRequest = service.getCatalogueCard('1');
    await Promise.resolve();
    resolveCards([{ ecard_id: '1', ecard_name: 'Grocer' }]);

    await expect(listRequest).resolves.toEqual([
      expect.objectContaining({ id: '1' }),
    ]);
    await expect(detailRequest).resolves.toMatchObject({ id: '1' });
    expect(api.getEcards).toHaveBeenCalledTimes(1);
  });

  it('waits for another instance to populate the Redis cache', async () => {
    const cached = [
      {
        id: '1',
        name: 'Cached card',
        category: null,
        discountPercent: 0,
        imageFilename: null,
        imageUrl: null,
        priceType: '',
        availableValues: [],
        balanceLink: null,
        description: null,
        terms: null,
        deliveryFee: 0,
        featured: false,
      },
    ];
    const { service, api, redis } = createService({
      redis: {
        get: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(cached),
        setIfAbsent: jest.fn().mockResolvedValue(false),
      },
      config: {
        get: jest.fn((key: string, fallback: unknown) =>
          key === 'PERKS_CATALOGUE_LOCK_WAIT_MS' ? '1' : fallback,
        ),
      },
    });

    await expect(service.getCatalogue({})).resolves.toEqual([
      expect.objectContaining({ id: '1' }),
    ]);
    expect(api.getEcards).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('falls back to one upstream request when Redis is unavailable', async () => {
    const { service, api } = createService({
      redis: {
        get: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
        setIfAbsent: jest
          .fn()
          .mockRejectedValue(new Error('Redis unavailable')),
        set: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      },
      api: {
        getEcards: jest
          .fn()
          .mockResolvedValue([{ ecard_id: '1', ecard_name: 'Available' }]),
      },
    });

    const [first, second] = await Promise.all([
      service.getCatalogue({}),
      service.getCatalogue({}),
    ]);
    expect(first).toEqual([expect.objectContaining({ id: '1' })]);
    expect(second).toEqual(first);
    expect(api.getEcards).toHaveBeenCalledTimes(1);
  });

  it('releases the catalogue lock when the upstream request fails', async () => {
    const { service, redis } = createService({
      api: {
        getEcards: jest.fn().mockRejectedValue(
          new PerksApiError('WMAD unavailable', 503, 'WMAD_DOWN', true, false),
        ),
      },
    });

    await expect(service.getCatalogue({})).rejects.toBeDefined();
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('filters the merchant wallet to the current Saveful user orders', async () => {
    const { service } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      orderModel: {
        find: jest.fn(() => ({
          select: jest.fn(() =>
            lean([
              {
                wmadOrderNumber: '123',
                orderReference: 'SVOWNED',
              },
            ]),
          ),
        })),
      },
      api: {
        getWallet: jest.fn().mockResolvedValue([
          {
            ecard_name: 'Owned card',
            order_number: '123',
            order_reference: 'SVOWNED',
            card_senddate: '2026-07-01',
          },
          {
            ecard_name: 'Another user card',
            order_number: '999',
            order_reference: 'SVOTHER',
          },
        ]),
      },
    });

    await expect(service.getWallet(userId, false)).resolves.toEqual([
      expect.objectContaining({
        cardName: 'Owned card',
        orderNumber: '123',
        issuedAt: '2026-07-01',
      }),
    ]);
  });

  it('reports current profile gaps without registering membership', async () => {
    const { service, membershipModel, api } = createService({
      userModel: {
        findById: jest.fn(() =>
          lean({
            _id: userId,
            name: 'Cher',
            email: 'cher@example.com',
            pincode: '12345',
          }),
        ),
      },
    });

    await expect(service.getMembershipStatus(userId)).resolves.toMatchObject({
      status: 'not_registered',
      missingFields: ['name'],
    });
    expect(membershipModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(api.registerUser).not.toHaveBeenCalled();
  });

  it('uses cart cents math for single-line quote rounding', async () => {
    const { service } = createService({
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Rounded card',
            ecard_price: '19.99',
            discount: 4.55,
            delivery_fee: 0.1,
          },
        ]),
      },
    });

    await expect(
      service.quote({ ecardId: '340', ecardValue: 19.99, quantity: 3 }),
    ).resolves.toMatchObject({
      currency: 'AUD',
      items: [
        {
          itemId: 'preview',
          faceValueCents: 5997,
          purchasePriceCents: 5724,
          deliveryFeeCents: 30,
          totalCents: 5754,
        },
      ],
      totals: {
        faceValueCents: 5997,
        purchasePriceCents: 5724,
        deliveryFeeCents: 30,
        totalCents: 5754,
      },
    });
  });

  it('releases a failed partial checkout and resumes only unissued lines', async () => {
    const cart = {
      _id: new Types.ObjectId(),
      status: 'active',
      checkoutIdempotencyKey: null as string | null,
      orderId: null,
      checkedOutAt: null,
      items: [
        {
          itemId: 'line-a',
          ecardId: '340',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
        {
          itemId: 'line-b',
          ecardId: '341',
          quantity: 1,
          faceValueCents: 2500,
          sendAsGift: false,
          gift: null,
        },
      ],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    let order: Record<string, any> | null = null;
    const { service, api } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      cartModel: {
        findOneAndUpdate: jest.fn(async () => {
          cart.status = 'checking_out';
          cart.checkoutIdempotencyKey = 'resume_checkout';
          return cart;
        }),
      },
      orderModel: {
        findOne: jest.fn(async () => order),
        create: jest.fn(async (payload: Record<string, unknown>) => {
          order = {
            ...payload,
            save: jest.fn(),
            toObject() {
              return this;
            },
          };
          return order;
        }),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Card A',
            ecard_price: '50',
            discount: 5,
          },
          {
            ecard_id: '341',
            ecard_name: 'Card B',
            ecard_price: '25',
            discount: 5,
          },
        ]),
        createOrder: jest
          .fn()
          .mockResolvedValueOnce({ order_number: '1001', order_status: 2 })
          .mockRejectedValueOnce(
            new PerksApiError('declined', 400, 'DECLINED', false, false),
          )
          .mockResolvedValueOnce({ order_number: '1002', order_status: 2 }),
      },
    });

    await expect(
      service.checkoutCart(userId, 'resume_checkout'),
    ).rejects.toMatchObject({ status: 400 });
    expect(cart.status).toBe('active');

    await expect(
      service.checkoutCart(userId, 'resume_checkout'),
    ).resolves.toMatchObject({
      status: PerksOrderStatus.COMPLETED,
      lines: [{ orderNumber: '1001' }, { orderNumber: '1002' }],
    });
    expect(api.createOrder).toHaveBeenCalledTimes(3);
    expect(cart.status).toBe('checked_out');
  });

  it('recovers an ambiguous cart for reading but never replays its line', async () => {
    const cart = {
      _id: new Types.ObjectId(),
      status: 'active',
      checkoutIdempotencyKey: null as string | null,
      orderId: null,
      checkedOutAt: null,
      items: [
        {
          itemId: 'line-a',
          ecardId: '340',
          quantity: 1,
          faceValueCents: 5000,
          sendAsGift: false,
          gift: null,
        },
      ],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    let order: Record<string, any> | null = null;
    const { service, api } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
          }),
        ),
      },
      cartModel: {
        findOneAndUpdate: jest.fn(async () => {
          cart.status = 'checking_out';
          cart.checkoutIdempotencyKey = 'ambiguous_checkout';
          return cart;
        }),
        findOne: jest.fn().mockResolvedValue(cart),
      },
      orderModel: {
        findOne: jest.fn(async () => order),
        create: jest.fn(async (payload: Record<string, unknown>) => {
          order = {
            ...payload,
            save: jest.fn(),
            toObject() {
              return this;
            },
          };
          return order;
        }),
      },
      api: {
        getEcards: jest.fn().mockResolvedValue([
          {
            ecard_id: '340',
            ecard_name: 'Card A',
            ecard_price: '50',
            discount: 5,
          },
        ]),
        createOrder: jest
          .fn()
          .mockRejectedValue(
            new PerksApiError('timed out', 503, 'TIMEOUT', true, true),
          ),
      },
    });

    await expect(
      service.checkoutCart(userId, 'ambiguous_checkout'),
    ).rejects.toMatchObject({ status: 503 });
    expect(cart.status).toBe('active');
    await expect(service.getCart(userId)).resolves.toMatchObject({
      status: 'active',
    });
    await expect(
      service.checkoutCart(userId, 'ambiguous_checkout'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(api.createOrder).toHaveBeenCalledTimes(1);
  });

  it('recovers a checking-out cart and preserves one-active-cart concurrency', async () => {
    const recovered = {
      _id: new Types.ObjectId(),
      status: 'checking_out',
      items: [],
      save: jest.fn(),
      toObject() {
        return this;
      },
    };
    const { service } = createService({
      cartModel: {
        findOne: jest.fn().mockResolvedValue(recovered),
      },
    });

    await expect(service.getCart(userId)).resolves.toMatchObject({
      status: 'active',
    });
    expect(recovered.save).toHaveBeenCalled();

    const concurrent = {
      ...recovered,
      status: 'active',
      save: jest.fn(),
    };
    const concurrentService = createService({
      cartModel: {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(concurrent),
        create: jest.fn().mockRejectedValue({ code: 11000 }),
      },
    }).service;
    await expect(concurrentService.getCart(userId)).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('verifies wallet ownership before archive or hide metadata writes', async () => {
    const ownedKey = 'a'.repeat(64);
    const otherKey = 'b'.repeat(64);
    const otherUserId = new Types.ObjectId().toString();
    const { service, walletMetadataModel } = createService();
    jest
      .spyOn(service, 'getWallet')
      .mockImplementation(async (requestedUserId: string) =>
        requestedUserId === userId
          ? ([{ cardKey: ownedKey }] as Awaited<
              ReturnType<PerksService['getWallet']>
            >)
          : [],
      );

    await expect(
      service.setWalletArchived(userId, ownedKey, true),
    ).resolves.toEqual({ cardKey: ownedKey, archived: true });
    await expect(
      service.hideWalletCard(userId, otherKey),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.setWalletArchived(otherUserId, ownedKey, false),
    ).rejects.toMatchObject({ status: 404 });
    expect(walletMetadataModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('persists calculator results for the authenticated user', async () => {
    const calculatedAt = expect.any(Date);
    const { service, calculatorProfileModel } = createService({
      calculatorProfileModel: {
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      service.calculateAndSave(userId, {
        items: [
          {
            category: 'groceries',
            amount: 10,
            frequency: PerksSpendFrequency.WEEKLY,
          },
        ],
      }),
    ).resolves.toMatchObject({ calculatedAt });
    expect(calculatorProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: expect.any(Types.ObjectId) },
      expect.objectContaining({
        $set: expect.objectContaining({ calculatedAt: expect.any(Date) }),
      }),
      { upsert: true },
    );
  });

  it('returns dashboard counts, cart totals, recent orders, and calculator data', async () => {
    const { service } = createService({
      membershipModel: {
        findOne: jest.fn(() =>
          lean({
            wmadUserId: '1',
            status: PerksMembershipStatus.ACTIVE,
            registeredAt: new Date('2026-07-01'),
          }),
        ),
      },
      favouriteModel: {
        countDocuments: jest.fn().mockResolvedValue(3),
      },
      cartModel: {
        findOne: jest.fn(() =>
          lean({
            _id: new Types.ObjectId(),
            status: 'active',
            items: [
              {
                itemId: 'line-a',
                ecardId: '340',
                quantity: 2,
                faceValueCents: 5000,
                sendAsGift: false,
                gift: null,
              },
            ],
          }),
        ),
      },
      orderModel: {
        find: jest.fn(() => ({
          sort: jest.fn(() => ({
            limit: jest.fn(() =>
              lean([
                {
                  orderReference: 'SVRECENT',
                  status: PerksOrderStatus.COMPLETED,
                  faceValueCents: 5000,
                  purchasePriceCents: 4750,
                  deliveryFeeCents: 0,
                  totalCents: 4750,
                },
              ]),
            ),
          })),
        })),
      },
      calculatorProfileModel: {
        findOne: jest.fn(() =>
          lean({
            inputs: [{ category: 'groceries' }],
            result: { totals: { annual: 234 } },
            calculatedAt: new Date('2026-07-02'),
          }),
        ),
      },
    });

    await expect(service.getDashboard(userId)).resolves.toMatchObject({
      membership: { status: PerksMembershipStatus.ACTIVE },
      favouriteCount: 3,
      cart: {
        status: 'active',
        items: [{ quantity: 2, ecardValue: 50 }],
      },
      recentOrders: [
        {
          orderReference: 'SVRECENT',
          totals: { faceValue: 50, purchasePrice: 47.5, total: 47.5 },
        },
      ],
      latestCalculator: { result: { totals: { annual: 234 } } },
    });
  });
});
