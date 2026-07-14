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
  const api = {
    registerUser: jest.fn(),
    getEcards: jest.fn(),
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

  return {
    service: new PerksService(
      userModel as never,
      membershipModel as never,
      orderModel as never,
      api as never,
    ),
    userModel,
    membershipModel,
    orderModel,
    api,
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

    await expect(service.ensureMembership(userId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
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
      }),
    ]);
  });
});
