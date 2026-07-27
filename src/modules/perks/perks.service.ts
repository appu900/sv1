import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  Gender,
  HealthProfile,
  HealthProfileDocument,
} from '../../database/schemas/nutrition/health-profile.schema';
import {
  PerksCalculatorProfile,
  PerksCalculatorProfileDocument,
} from '../../database/schemas/perks-calculator-profile.schema';
import {
  PerksCart,
  PerksCartDocument,
  PerksCartStatus,
} from '../../database/schemas/perks-cart.schema';
import {
  PerksFavourite,
  PerksFavouriteDocument,
} from '../../database/schemas/perks-favourite.schema';
import {
  PerksMembership,
  PerksMembershipDocument,
  PerksMembershipStatus,
} from '../../database/schemas/perks-membership.schema';
import {
  PerksOrder,
  PerksOrderDocument,
  PerksOrderStatus,
} from '../../database/schemas/perks-order.schema';
import {
  PerksWalletMetadata,
  PerksWalletMetadataDocument,
} from '../../database/schemas/perks-wallet-metadata.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { RedisService } from '../../redis/redis.service';
import {
  AddPerksFavouriteDto,
  CalculatePerksDto,
  CreatePerksOrderDto,
  PerksCartItemDto,
  PerksCatalogueQueryDto,
  PerksCatalogueSort,
  PerksOrderListQueryDto,
  PerksSpendFrequency,
  QuotePerksDto,
  UpdatePerksCartItemDto,
} from './dto/perks.dto';
import {
  PerksApiClient,
  PerksApiError,
  WmadGenderCode,
  WmadOrderResult,
} from './perks-api-client';

export const PERKS_CATEGORIES = [
  { key: 'groceries', name: 'Groceries', discountBps: 450 },
  { key: 'fuel', name: 'Fuel', discountBps: 200 },
  {
    key: 'pharmacy',
    name: 'Pharmacy, Health & Beauty',
    discountBps: 500,
  },
  { key: 'dining', name: 'Dining out', discountBps: 500 },
  { key: 'entertainment', name: 'Entertainment', discountBps: 500 },
  { key: 'fashion', name: 'Clothes & Fashion', discountBps: 500 },
  { key: 'hardware', name: 'Hardware & auto', discountBps: 500 },
  { key: 'beer-wine', name: 'Beer & Wine', discountBps: 500 },
  { key: 'travel', name: 'Travel & Accommodation', discountBps: 1000 },
] as const;

/** Older calculator keys that still resolve to the canonical set. */
const PERKS_CATEGORY_ALIASES: Record<string, string> = {
  grocery: 'groceries',
  petrol: 'fuel',
  health: 'pharmacy',
  beauty: 'pharmacy',
  'health-beauty': 'pharmacy',
  'pharmacy-health-beauty': 'pharmacy',
  'dining-out': 'dining',
  restaurant: 'dining',
  'eats-drinks': 'dining',
  eats: 'dining',
  clothes: 'fashion',
  'clothes-fashion': 'fashion',
  'hardware-auto': 'hardware',
  auto: 'hardware',
  home: 'hardware',
  beer: 'beer-wine',
  wine: 'beer-wine',
  alcohol: 'beer-wine',
  accommodation: 'travel',
  'travel-accommodation': 'travel',
};

export interface CatalogueCard {
  id: string;
  name: string;
  category: string | null;
  discountPercent: number;
  imageFilename: string | null;
  imageUrl: string | null;
  priceType: string;
  availableValues: number[];
  balanceLink: string | null;
  description: string | null;
  terms: string | null;
  deliveryFee: number;
  featured: boolean;
}

@Injectable()
export class PerksService {
  private catalogueRefreshPromise: Promise<CatalogueCard[]> | null = null;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(HealthProfile.name)
    private readonly healthProfileModel: Model<HealthProfileDocument>,
    @InjectModel(PerksMembership.name)
    private readonly membershipModel: Model<PerksMembershipDocument>,
    @InjectModel(PerksOrder.name)
    private readonly orderModel: Model<PerksOrderDocument>,
    @InjectModel(PerksFavourite.name)
    private readonly favouriteModel: Model<PerksFavouriteDocument>,
    @InjectModel(PerksCart.name)
    private readonly cartModel: Model<PerksCartDocument>,
    @InjectModel(PerksWalletMetadata.name)
    private readonly walletMetadataModel: Model<PerksWalletMetadataDocument>,
    @InjectModel(PerksCalculatorProfile.name)
    private readonly calculatorProfileModel: Model<PerksCalculatorProfileDocument>,
    private readonly api: PerksApiClient,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async getMembershipStatus(userId: string) {
    const objectId = this.toObjectId(userId);
    const [membership, user, healthProfile] = await Promise.all([
      this.membershipModel.findOne({ userId: objectId }).lean(),
      this.userModel.findById(objectId).lean(),
      this.healthProfileModel
        .findOne({ userId: objectId })
        .select({ gender: 1 })
        .lean(),
    ]);
    if (!user) {
      throw new NotFoundException('Saveful user not found');
    }
    const status = membership
      ? this.membershipResponse(membership)
      : {
          wmadUserId: null,
          status: 'not_registered',
          registeredAt: null,
        };
    return {
      ...status,
      missingFields: this.profileMissingFields(
        user,
        (healthProfile?.gender as Gender | undefined) ?? null,
      ),
    };
  }

  async ensureMembership(userId: string) {
    const objectId = this.toObjectId(userId);
    const existing = await this.membershipModel
      .findOne({
        userId: objectId,
        status: PerksMembershipStatus.ACTIVE,
      })
      .lean();
    if (existing) {
      return this.membershipResponse(existing);
    }

    const [user, healthProfile] = await Promise.all([
      this.userModel.findById(objectId).lean(),
      this.healthProfileModel
        .findOne({ userId: objectId })
        .select({ gender: 1 })
        .lean(),
    ]);
    if (!user) {
      throw new NotFoundException('Saveful user not found');
    }
    const fallbackGender =
      (healthProfile?.gender as Gender | undefined) ?? null;
    const registration = this.mapRegistration(user, fallbackGender);

    // Retry failed/unknown/stuck pending rows. Only ACTIVE short-circuits above.
    let membership = await this.membershipModel.findOneAndUpdate(
      {
        userId: objectId,
        status: {
          $in: [
            PerksMembershipStatus.FAILED,
            PerksMembershipStatus.UNKNOWN,
            PerksMembershipStatus.PENDING,
          ],
        },
      },
      {
        $set: {
          status: PerksMembershipStatus.PENDING,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      { new: true },
    );

    if (!membership) {
      try {
        membership = await this.membershipModel.create({
          userId: objectId,
          email: user.email.toLowerCase(),
          wmadUserId: null,
          status: PerksMembershipStatus.PENDING,
        });
      } catch (error) {
        if (this.isDuplicateKey(error)) {
          const concurrent = await this.membershipModel
            .findOne({ userId: objectId })
            .lean();
          if (concurrent?.status === PerksMembershipStatus.ACTIVE) {
            return this.membershipResponse(concurrent);
          }
          membership = await this.membershipModel.findOneAndUpdate(
            { userId: objectId },
            {
              $set: {
                status: PerksMembershipStatus.PENDING,
                lastErrorCode: null,
                lastErrorMessage: null,
              },
            },
            { new: true },
          );
          if (!membership) {
            throw new ConflictException(
              'Perks registration is already in progress',
            );
          }
        } else {
          throw error;
        }
      }
    }

    try {
      const result = await this.api.registerUser(registration);
      membership.wmadUserId = String(result.user_id);
      membership.status = PerksMembershipStatus.ACTIVE;
      membership.registeredAt = new Date();
      await membership.save();
      return this.membershipResponse(membership.toObject());
    } catch (error) {
      const apiError = this.asApiError(error);
      membership.status = apiError.ambiguous
        ? PerksMembershipStatus.UNKNOWN
        : PerksMembershipStatus.FAILED;
      membership.lastErrorCode = apiError.code;
      membership.lastErrorMessage = apiError.message;
      await membership.save();
      if (apiError.ambiguous || apiError.retryable) {
        this.throwUpstream(apiError, 'Could not register the Saveful user');
      }
      // Surface profile gaps when WMAD rejects so the app can send users
      // to complete autofilled details instead of a dead-end error.
      const missingFields = this.profileMissingFields(user, fallbackGender);
      throw new UnprocessableEntityException({
        message:
          'WeMAD could not register your account. Confirm your first name, last name, postcode and gender, then try again.',
        missingFields:
          missingFields.length > 0
            ? missingFields
            : ['name', 'pincode', 'gender'],
        code: apiError.code,
        upstreamMessage: apiError.message,
      });
    }
  }

  async getEcards(userId: string) {
    this.toObjectId(userId);
    return this.getCatalogue({});
  }

  async getCatalogue(query: PerksCatalogueQueryDto) {
    let cards = await this.getCachedCatalogue();
    const q = query.q?.trim().toLowerCase();
    const category = query.category?.trim().toLowerCase();
    if (q) {
      cards = cards.filter((card) =>
        [card.name, card.category, card.description]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(q)),
      );
    }
    if (category) {
      cards = cards.filter((card) => card.category?.toLowerCase() === category);
    }
    if (query.featured !== undefined) {
      cards = cards.filter((card) => card.featured === query.featured);
    }
    cards.sort((left, right) => {
      if (query.sort === PerksCatalogueSort.DISCOUNT_DESC) {
        return right.discountPercent - left.discountPercent;
      }
      if (query.sort === PerksCatalogueSort.DISCOUNT_ASC) {
        return left.discountPercent - right.discountPercent;
      }
      return left.name.localeCompare(right.name);
    });
    return cards.map(({ description: _description, terms: _terms, ...card }) => card);
  }

  async getCatalogueCard(ecardId: string) {
    if (!/^\d+$/.test(ecardId)) {
      throw new BadRequestException('Invalid ecard ID');
    }
    const card = (await this.getCachedCatalogue()).find(
      (item) => item.id === ecardId,
    );
    if (!card) {
      throw new NotFoundException('Perks card not found');
    }
    return card;
  }

  async getGiftOptions(userId: string) {
    await this.ensureMembership(userId);
    const data = await this.callUpstream(() => this.api.getGiftOptions());
    return {
      templates: this.arrayValue(data.gift_template).map((item) => ({
        id: this.stringValue(item.template_id),
        name: this.stringValue(item.template_name),
        subject: this.stringValue(item.template_subject),
      })),
      consultants: this.arrayValue(data.gift_consultant).map((item) => ({
        id: this.stringValue(item.consultant_id),
        firstName: this.stringValue(item.consultant_firstname),
        lastName: this.stringValue(item.consultant_lastname),
        email: this.stringValue(item.consultant_email),
      })),
      categories: this.stringArray(data.gift_category),
      subcategories: this.stringArray(data.gift_subcategory),
    };
  }

  async getFavourites(userId: string) {
    const objectId = this.toObjectId(userId);
    const favourites = await this.favouriteModel
      .find({ userId: objectId })
      .sort({ createdAt: -1 })
      .lean();
    if (favourites.length === 0) {
      return [];
    }
    const cards = await this.getCachedCatalogue();
    const byId = new Map(cards.map((card) => [card.id, card]));
    return favourites.map((favourite) => ({
      ecardId: favourite.ecardId,
      card: byId.get(favourite.ecardId) ?? null,
      createdAt: (favourite as { createdAt?: Date }).createdAt ?? null,
    }));
  }

  async addFavourite(userId: string, dto: AddPerksFavouriteDto) {
    await this.getCatalogueCard(dto.ecardId);
    const favourite = await this.favouriteModel.findOneAndUpdate(
      { userId: this.toObjectId(userId), ecardId: dto.ecardId },
      {
        $setOnInsert: { userId: this.toObjectId(userId), ecardId: dto.ecardId },
      },
      { new: true, upsert: true },
    );
    return { ecardId: favourite.ecardId };
  }

  async removeFavourite(userId: string, ecardId: string) {
    if (!/^\d+$/.test(ecardId)) {
      throw new BadRequestException('Invalid ecard ID');
    }
    await this.favouriteModel.deleteOne({
      userId: this.toObjectId(userId),
      ecardId,
    });
    return { ecardId, removed: true };
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateActiveCart(userId);
    return this.cartResponse(cart.toObject());
  }

  async addCartItem(userId: string, dto: PerksCartItemDto) {
    const card = await this.getCatalogueCard(dto.ecardId);
    this.assertCardValue(card, dto.ecardValue);
    const cart = await this.getOrCreateActiveCart(userId);
    const existing = cart.items.find(
      (item) =>
        item.ecardId === dto.ecardId &&
        item.faceValueCents === Math.round(dto.ecardValue * 100) &&
        item.sendAsGift === Boolean(dto.sendAsGift),
    );
    if (existing) {
      existing.quantity = Math.min(100, existing.quantity + dto.quantity);
    } else {
      cart.items.push({
        itemId: randomUUID(),
        ecardId: dto.ecardId,
        quantity: dto.quantity,
        faceValueCents: Math.round(dto.ecardValue * 100),
        sendAsGift: Boolean(dto.sendAsGift),
        gift: dto.sendAsGift
          ? {
              recipientName: dto.giftRecipientName!,
              recipientEmail: dto.giftRecipientEmail!,
              templateId: dto.giftTemplateId!,
            }
          : null,
      });
    }
    await cart.save();
    return this.cartResponse(cart.toObject());
  }

  async updateCartItem(
    userId: string,
    itemId: string,
    dto: UpdatePerksCartItemDto,
  ) {
    const cart = await this.getOrCreateActiveCart(userId);
    const item = cart.items.find((candidate) => candidate.itemId === itemId);
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    if (dto.ecardValue !== undefined) {
      const card = await this.getCatalogueCard(item.ecardId);
      this.assertCardValue(card, dto.ecardValue);
      item.faceValueCents = Math.round(dto.ecardValue * 100);
    }
    if (dto.quantity !== undefined) {
      item.quantity = dto.quantity;
    }
    await cart.save();
    return this.cartResponse(cart.toObject());
  }

  async deleteCartItem(userId: string, itemId: string) {
    const cart = await this.getOrCreateActiveCart(userId);
    const length = cart.items.length;
    cart.items = cart.items.filter((item) => item.itemId !== itemId);
    if (cart.items.length === length) {
      throw new NotFoundException('Cart item not found');
    }
    await cart.save();
    return this.cartResponse(cart.toObject());
  }

  async quoteCart(userId: string) {
    const cart = await this.getOrCreateActiveCart(userId);
    return this.buildCartQuote(cart.toObject());
  }

  async quote(dto: QuotePerksDto) {
    const card = await this.getCatalogueCard(dto.ecardId);
    this.assertCardValue(card, dto.ecardValue);
    return this.buildCartQuote({
      items: [
        {
          itemId: 'preview',
          ecardId: dto.ecardId,
          quantity: dto.quantity,
          faceValueCents: Math.round(dto.ecardValue * 100),
          sendAsGift: Boolean(dto.sendAsGift),
          gift: dto.sendAsGift
            ? {
                recipientName: dto.giftRecipientName!,
                recipientEmail: dto.giftRecipientEmail!,
                templateId: dto.giftTemplateId!,
              }
            : null,
        },
      ],
    });
  }

  async listOrders(userId: string, query: PerksOrderListQueryDto) {
    const [orders, total] = await Promise.all([
      this.orderModel
        .find({ userId: this.toObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .lean(),
      this.orderModel.countDocuments({ userId: this.toObjectId(userId) }),
    ]);
    return {
      items: orders.map((order) => this.orderResponse(order)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getDashboard(userId: string) {
    const objectId = this.toObjectId(userId);
    const [membership, favouriteCount, cart, recentOrders, calculator] =
      await Promise.all([
        this.membershipModel.findOne({ userId: objectId }).lean(),
        this.favouriteModel.countDocuments({ userId: objectId }),
        this.cartModel
          .findOne({ userId: objectId, status: PerksCartStatus.ACTIVE })
          .lean(),
        this.orderModel
          .find({ userId: objectId })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        this.calculatorProfileModel.findOne({ userId: objectId }).lean(),
      ]);
    return {
      membership: membership
        ? this.membershipResponse(membership)
        : { wmadUserId: null, status: 'not_registered', registeredAt: null },
      favouriteCount,
      cart: cart ? this.cartResponse(cart) : null,
      recentOrders: recentOrders.map((order) => this.orderResponse(order)),
      latestCalculator: calculator
        ? {
            inputs: calculator.inputs,
            result: calculator.result,
            calculatedAt: calculator.calculatedAt,
          }
        : null,
    };
  }

  async createOrder(
    userId: string,
    idempotencyKey: string,
    dto: CreatePerksOrderDto,
  ) {
    this.assertIssuanceEnabled();
    await this.ensureMembership(userId);
    this.validateIdempotencyKey(idempotencyKey);
    const objectId = this.toObjectId(userId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');

    const existing = await this.orderModel
      .findOne({ userId: objectId, idempotencyKey })
      .lean();
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different order',
        );
      }
      return this.orderResponse(existing);
    }

    const card = await this.getCatalogueCard(dto.ecardId);
    this.assertCardValue(card, dto.ecardValue);
    const orderReference = this.createOrderReference(userId);
    const snapshot = this.quoteLine(
      {
        itemId: 'single',
        ecardId: dto.ecardId,
        faceValueCents: Math.round(dto.ecardValue * 100),
        quantity: dto.quantity,
      },
      card,
    );
    let order: PerksOrderDocument;
    try {
      order = await this.orderModel.create({
        userId: objectId,
        idempotencyKey,
        requestHash,
        orderReference,
        status: PerksOrderStatus.STARTED,
        currency: 'AUD',
        faceValueCents: snapshot.faceValueCents,
        purchasePriceCents: snapshot.purchasePriceCents,
        deliveryFeeCents: snapshot.deliveryFeeCents,
        totalCents: snapshot.totalCents,
        lines: [
          {
            ...snapshot,
            lineId: 'single',
            idempotencyKey: `${idempotencyKey}:single`,
            orderReference,
            status: PerksOrderStatus.STARTED,
          },
        ],
      });
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const concurrent = await this.orderModel
          .findOne({ userId: objectId, idempotencyKey })
          .lean();
        if (concurrent?.requestHash === requestHash) {
          return this.orderResponse(concurrent);
        }
      }
      throw error;
    }

    try {
      const result = await this.api.createOrder(
        this.mapOrderPayload(dto, orderReference),
      );
      this.applyOrderResult(order, result);
      if (order.lines[0]) {
        order.lines[0].wmadOrderNumber = String(result.order_number);
        order.lines[0].status = this.mapOrderStatus(result.order_status);
        order.lines[0].cardUrl = result.cardurl ?? null;
        order.lines[0].completedAt = new Date();
      }
      order.completedAt = new Date();
      await order.save();
      return this.orderResponse(order.toObject());
    } catch (error) {
      const apiError = this.asApiError(error);
      order.status = apiError.ambiguous
        ? PerksOrderStatus.UNKNOWN
        : PerksOrderStatus.FAILED;
      order.lastErrorCode = apiError.code;
      order.lastErrorMessage = apiError.message;
      if (order.lines[0]) {
        order.lines[0].status = order.status;
        order.lines[0].lastErrorCode = apiError.code;
        order.lines[0].lastErrorMessage = apiError.message;
      }
      await order.save();
      this.throwUpstream(apiError, 'Could not place the gift-card order');
    }
  }

  async checkoutCart(userId: string, idempotencyKey: string) {
    this.validateIdempotencyKey(idempotencyKey);
    if (!this.isIssuanceEnabled()) {
      const cart = await this.getOrCreateActiveCart(userId);
      if (cart.items.length === 0) {
        throw new BadRequestException('An active cart with items is required');
      }
      const quote = await this.buildCartQuote(cart.toObject());
      return {
        status: 'payment_required',
        issuanceEnabled: false,
        quote,
        message:
          'Perks checkout is ready, but payment and order issuance are not yet enabled.',
      };
    }

    const objectId = this.toObjectId(userId);
    const prior = await this.orderModel.findOne({
      userId: objectId,
      idempotencyKey,
    });
    if (
      prior &&
      [PerksOrderStatus.COMPLETED, PerksOrderStatus.PROCESSING].includes(
        prior.status,
      ) &&
      prior.lines.every((line) =>
        [PerksOrderStatus.COMPLETED, PerksOrderStatus.PROCESSING].includes(
          line.status,
        ),
      )
    ) {
      return this.orderResponse(prior.toObject());
    }

    const cart = await this.cartModel.findOneAndUpdate(
      {
        userId: objectId,
        $or: [
          {
            status: PerksCartStatus.ACTIVE,
            $or: [
              { checkoutIdempotencyKey: null },
              { checkoutIdempotencyKey: { $exists: false } },
              { checkoutIdempotencyKey: idempotencyKey },
            ],
          },
          {
            status: PerksCartStatus.CHECKING_OUT,
            checkoutIdempotencyKey: idempotencyKey,
          },
        ],
      },
      {
        $set: {
          status: PerksCartStatus.CHECKING_OUT,
          checkoutIdempotencyKey: idempotencyKey,
        },
      },
      { new: true },
    );
    if (!cart) {
      const resumable = await this.cartModel.findOne({
        userId: objectId,
        status: {
          $in: [PerksCartStatus.ACTIVE, PerksCartStatus.CHECKING_OUT],
        },
      });
      if (resumable?.checkoutIdempotencyKey) {
        throw new ConflictException(
          'Cart checkout must resume with its original Idempotency-Key',
        );
      }
    }
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('An active cart with items is required');
    }

    let quote: Awaited<ReturnType<PerksService['buildCartQuote']>>;
    try {
      await this.ensureMembership(userId);
      quote = await this.buildCartQuote(cart.toObject());
    } catch (error) {
      await this.releaseCartForRetry(cart);
      throw error;
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify(quote.items))
      .digest('hex');
    if (prior && prior.requestHash !== requestHash) {
      await this.releaseCartForRetry(cart);
      throw new ConflictException(
        'Idempotency-Key was already used with a different cart',
      );
    }

    let order = prior;
    if (!order) {
      const orderReference = this.createOrderReference(userId);
      try {
        order = await this.orderModel.create({
          userId: objectId,
          cartId: cart._id,
          idempotencyKey,
          requestHash,
          orderReference,
          status: PerksOrderStatus.STARTED,
          currency: 'AUD',
          faceValueCents: quote.totals.faceValueCents,
          purchasePriceCents: quote.totals.purchasePriceCents,
          deliveryFeeCents: quote.totals.deliveryFeeCents,
          totalCents: quote.totals.totalCents,
          lines: quote.items.map((item) => ({
            ...item,
            lineId: item.itemId,
            idempotencyKey: `${idempotencyKey}:${item.itemId}`,
            orderReference: `${orderReference}-${item.itemId.slice(0, 8)}`,
            status: PerksOrderStatus.STARTED,
          })),
        });
      } catch (error) {
        if (!this.isDuplicateKey(error)) {
          await this.releaseCartForRetry(cart);
          throw error;
        }
        order = await this.orderModel.findOne({
          userId: objectId,
          idempotencyKey,
        });
        if (!order || order.requestHash !== requestHash) {
          await this.releaseCartForRetry(cart);
          throw new ConflictException('Checkout is already in progress');
        }
      }
    }

    if (order.lines.some((line) => line.status === PerksOrderStatus.UNKNOWN)) {
      await this.releaseCartForRetry(cart);
      throw new ConflictException(
        'Checkout contains an ambiguous line and requires reconciliation',
      );
    }

    for (const line of order.lines) {
      if (
        line.status === PerksOrderStatus.COMPLETED ||
        line.status === PerksOrderStatus.PROCESSING
      ) {
        continue;
      }
      const cartItem = cart.items.find((item) => item.itemId === line.lineId);
      if (!cartItem) {
        throw new ConflictException('Cart changed during checkout');
      }
      try {
        const result = await this.api.createOrder(
          this.mapCartOrderPayload(cartItem, line.orderReference),
        );
        line.wmadOrderNumber = String(result.order_number);
        line.status = this.mapOrderStatus(result.order_status);
        line.cardUrl = result.cardurl ?? null;
        line.completedAt = new Date();
        line.lastErrorCode = null;
        line.lastErrorMessage = null;
        await order.save();
      } catch (error) {
        const apiError = this.asApiError(error);
        line.status = apiError.ambiguous
          ? PerksOrderStatus.UNKNOWN
          : PerksOrderStatus.FAILED;
        line.lastErrorCode = apiError.code;
        line.lastErrorMessage = apiError.message;
        order.status = line.status;
        order.lastErrorCode = apiError.code;
        order.lastErrorMessage = apiError.message;
        await order.save();
        await this.releaseCartForRetry(cart);
        this.throwUpstream(apiError, 'Could not complete cart checkout');
      }
    }

    const allIssued = order.lines.every((line) =>
      [PerksOrderStatus.COMPLETED, PerksOrderStatus.PROCESSING].includes(
        line.status,
      ),
    );
    order.status = order.lines.every(
      (line) => line.status === PerksOrderStatus.COMPLETED,
    )
      ? PerksOrderStatus.COMPLETED
      : allIssued
        ? PerksOrderStatus.PROCESSING
        : PerksOrderStatus.FAILED;
    order.completedAt = allIssued ? new Date() : null;
    await order.save();
    if (allIssued) {
      cart.status = PerksCartStatus.CHECKED_OUT;
      cart.orderId = order._id as Types.ObjectId;
      cart.checkedOutAt = new Date();
      await cart.save();
    }
    return this.orderResponse(order.toObject());
  }

  async getOrder(userId: string, orderNumber: string) {
    const order = await this.findOwnedOrder(userId, orderNumber);
    const detail = await this.callUpstream(() =>
      this.api.getOrderDetail(orderNumber, order.orderReference),
    );
    order.status = this.mapOrderStatus(detail.order_status);
    order.cardUrl = this.nullableString(detail.cardurl);
    await order.save();
    return {
      ...this.orderResponse(order.toObject()),
      upstream: {
        cardUrl: order.cardUrl,
      },
    };
  }

  async cancelOrder(userId: string, orderNumber: string) {
    const order = await this.findOwnedOrder(userId, orderNumber);
    await this.callUpstream(() => this.api.cancelOrder(orderNumber));
    order.status = PerksOrderStatus.REFUNDED;
    await order.save();
    return this.orderResponse(order.toObject());
  }

  async getTaxReceipt(userId: string, orderNumber: string) {
    const order = await this.findOwnedOrder(userId, orderNumber);
    const result = await this.callUpstream(() =>
      this.api.getTaxReceipt(orderNumber),
    );
    order.receiptUrl = this.nullableString(result.receipturl);
    await order.save();
    return {
      orderNumber,
      receiptUrl: order.receiptUrl,
    };
  }

  async getWallet(
    userId: string,
    gifted: boolean,
    state: 'active' | 'archived' = 'active',
  ) {
    await this.ensureMembership(userId);
    const objectId = this.toObjectId(userId);
    const orders = await this.orderModel
      .find({ userId: objectId })
      .select({
        wmadOrderNumber: 1,
        orderReference: 1,
        'lines.wmadOrderNumber': 1,
        'lines.orderReference': 1,
      })
      .lean();
    const allowed = new Set(
      orders.flatMap((order) =>
        [
          order.wmadOrderNumber,
          order.orderReference,
          ...(order.lines ?? []).flatMap((line) => [
            line.wmadOrderNumber,
            line.orderReference,
          ]),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const entries = await this.callUpstream(() =>
      gifted ? this.api.getGiftedWallet() : this.api.getWallet(),
    );
    const mapped = entries
      .filter((entry) => {
        const number = this.stringValue(entry.order_number);
        const reference = this.stringValue(entry.order_reference);
        return allowed.has(number) || allowed.has(reference);
      })
      .map((entry) => this.mapWalletEntry(entry, gifted));
    const metadata = await this.walletMetadataModel
      .find({
        userId: objectId,
        cardKey: { $in: mapped.map((entry) => entry.cardKey) },
      })
      .lean();
    const metadataByKey = new Map(
      metadata.map((entry) => [entry.cardKey, entry]),
    );
    return mapped
      .map((entry) => {
        const local = metadataByKey.get(entry.cardKey);
        return {
          ...entry,
          archived: local?.archived ?? false,
          archivedAt: local?.archivedAt ?? null,
        };
      })
      .filter((entry) => {
        const local = metadataByKey.get(entry.cardKey);
        return (
          !local?.hidden &&
          (state === 'archived' ? entry.archived : !entry.archived)
        );
      });
  }

  async getWalletCard(userId: string, cardKey: string) {
    this.validateCardKey(cardKey);
    const cards = [
      ...(await this.getWallet(userId, false, 'active')),
      ...(await this.getWallet(userId, false, 'archived')),
      ...(await this.getWallet(userId, true, 'active')),
      ...(await this.getWallet(userId, true, 'archived')),
    ];
    const card = cards.find((entry) => entry.cardKey === cardKey);
    if (!card) {
      throw new NotFoundException('Wallet card not found');
    }
    return card;
  }

  async setWalletArchived(userId: string, cardKey: string, archived: boolean) {
    this.validateCardKey(cardKey);
    await this.getWalletCard(userId, cardKey);
    await this.walletMetadataModel.findOneAndUpdate(
      { userId: this.toObjectId(userId), cardKey },
      {
        $set: {
          archived,
          archivedAt: archived ? new Date() : null,
          hidden: false,
        },
        $setOnInsert: { userId: this.toObjectId(userId), cardKey },
      },
      { upsert: true, new: true },
    );
    return { cardKey, archived };
  }

  async hideWalletCard(userId: string, cardKey: string) {
    this.validateCardKey(cardKey);
    await this.getWalletCard(userId, cardKey);
    await this.walletMetadataModel.findOneAndUpdate(
      { userId: this.toObjectId(userId), cardKey },
      {
        $set: { hidden: true },
        $setOnInsert: { userId: this.toObjectId(userId), cardKey },
      },
      { upsert: true },
    );
    return { cardKey, hidden: true };
  }

  getCalculatorCategories() {
    return PERKS_CATEGORIES.map((category) => ({
      key: category.key,
      name: category.name,
      discountPercent: category.discountBps / 100,
    }));
  }

  calculate(dto: CalculatePerksDto) {
    const frequencies: Record<PerksSpendFrequency, number> = {
      [PerksSpendFrequency.WEEKLY]: 52,
      [PerksSpendFrequency.MONTHLY]: 12,
      [PerksSpendFrequency.ANNUALLY]: 1,
    };

    const items = dto.items.map((item) => {
      const category = this.findCategory(item.category);
      const amountCents = Math.round(item.amount * 100);
      const annualSpendCents = amountCents * frequencies[item.frequency];
      const annualSavingsCents = Math.round(
        (annualSpendCents * category.discountBps) / 10_000,
      );
      return {
        category: category.name,
        categoryKey: category.key,
        discountPercent: category.discountBps / 100,
        amount: this.currency(amountCents),
        frequency: item.frequency,
        annualSpend: this.currency(annualSpendCents),
        savings: this.savings(annualSavingsCents),
        annualSavingsCents,
      };
    });

    const totalAnnualSavingsCents = items.reduce(
      (sum, item) => sum + item.annualSavingsCents,
      0,
    );
    return {
      items: items.map(({ annualSavingsCents: _, ...item }) => item),
      totals: this.savings(totalAnnualSavingsCents),
    };
  }

  async calculateAndSave(userId: string, dto: CalculatePerksDto) {
    const result = this.calculate(dto);
    const calculatedAt = new Date();
    await this.calculatorProfileModel.findOneAndUpdate(
      { userId: this.toObjectId(userId) },
      {
        $set: {
          inputs: dto.items,
          result,
          calculatedAt,
        },
        $setOnInsert: { userId: this.toObjectId(userId) },
      },
      { upsert: true },
    );
    return { ...result, calculatedAt };
  }

  async getLatestCalculation(userId: string) {
    const profile = await this.calculatorProfileModel
      .findOne({ userId: this.toObjectId(userId) })
      .lean();
    if (!profile) {
      return null;
    }
    return {
      inputs: profile.inputs,
      result: profile.result,
      calculatedAt: profile.calculatedAt,
    };
  }

  private async getCachedCatalogue(): Promise<CatalogueCard[]> {
    const cacheKey = 'perks:catalogue:v1';
    try {
      const cached = await this.redis.get<CatalogueCard[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Catalogue remains available if Redis is temporarily unavailable.
    }

    if (this.catalogueRefreshPromise) {
      return this.catalogueRefreshPromise;
    }

    const refresh = this.refreshCatalogue(cacheKey);
    this.catalogueRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.catalogueRefreshPromise === refresh) {
        this.catalogueRefreshPromise = null;
      }
    }
  }

  private async refreshCatalogue(cacheKey: string): Promise<CatalogueCard[]> {
    const lockKey = `${cacheKey}:lock`;
    const lockToken = randomUUID();
    const lockTtlSeconds = 15;
    let hasLock = false;

    try {
      hasLock = await this.redis.setIfAbsent(
        lockKey,
        lockToken,
        lockTtlSeconds,
      );
    } catch {
      // Redis is optional for availability; the in-process promise still
      // prevents duplicate WMAD requests inside this API instance.
      return this.fetchAndCacheCatalogue(cacheKey);
    }

    if (!hasLock) {
      const waitMs = this.positiveConfigNumber(
        'PERKS_CATALOGUE_LOCK_WAIT_MS',
        16_000,
      );
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await this.delay(Math.min(250, Math.max(1, deadline - Date.now())));
        try {
          const cached = await this.redis.get<CatalogueCard[]>(cacheKey);
          if (cached) {
            return cached;
          }
          hasLock = await this.redis.setIfAbsent(
            lockKey,
            lockToken,
            lockTtlSeconds,
          );
          if (hasLock) {
            break;
          }
        } catch {
          return this.fetchAndCacheCatalogue(cacheKey);
        }
      }
    }

    try {
      return await this.fetchAndCacheCatalogue(cacheKey);
    } finally {
      if (hasLock) {
        try {
          await this.redis.releaseLock(lockKey, lockToken);
        } catch {
          // The lock has a short TTL, so release failures are self-healing.
        }
      }
    }
  }

  private async fetchAndCacheCatalogue(
    cacheKey: string,
  ): Promise<CatalogueCard[]> {
    const rawCards = await this.callUpstream(() => this.api.getEcards());
    const cards = rawCards
      .map((card) => this.mapCatalogueCard(card))
      .filter((card) => Boolean(card.id && card.name));
    try {
      const ttl = this.positiveConfigNumber(
        'PERKS_CATALOGUE_CACHE_TTL_SECONDS',
        300,
      );
      await this.redis.set(cacheKey, cards, ttl);
    } catch {
      // A cache write failure must not fail a successful WMAD response.
    }
    return cards;
  }

  private positiveConfigNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key, String(fallback)));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapCatalogueCard(card: Record<string, unknown>): CatalogueCard {
    const featured = card.ecard_featured ?? card.featured;
    const name = this.stringValue(card.ecard_name).trim();
    const explicitCategory = this.nullableString(
      card.ecard_category ?? card.category ?? card.ecard_type,
    );
    return {
      id: this.stringValue(card.ecard_id),
      name,
      // WMAD /ecard currently omits category fields; infer browse groups from name.
      category: explicitCategory ?? this.inferCatalogueCategory(name),
      discountPercent:
        this.numberValue(card.discount ?? card.ecard_discount) ?? 0,
      imageFilename: this.safeImageFilename(card.ecard_image),
      imageUrl: this.cardImageUrl(card.ecard_image),
      priceType: this.stringValue(card.ecard_pricetype),
      availableValues: this.parseCardValues(card.ecard_price),
      balanceLink: this.nullableString(card.ecard_balancelink),
      description: this.nullableString(card.ecard_desc),
      terms: this.nullableString(card.ecard_term),
      deliveryFee: this.numberValue(card.delivery_fee) ?? 0,
      featured:
        featured === true ||
        featured === 1 ||
        String(featured).toLowerCase() === 'true' ||
        String(featured) === '1' ||
        (this.numberValue(card.discount ?? card.ecard_discount) ?? 0) >= 5,
    };
  }

  private inferCatalogueCategory(name: string): string {
    const haystack = name.toLowerCase();
    const rules: Array<{ category: string; keywords: string[] }> = [
      {
        category: 'groceries',
        keywords: [
          'woolworths',
          'coles',
          'aldi',
          'iga',
          'harris farm',
          'supermarket',
          'grocery',
          'foodland',
          'drakes',
        ],
      },
      {
        category: 'fuel',
        keywords: [
          'fuel',
          'shell',
          'caltex',
          'ampol',
          'petrol',
          'bp gift',
          '7-eleven',
        ],
      },
      {
        category: 'dining',
        keywords: [
          'restaurant',
          'cafe',
          'coffee',
          'dining',
          'mcdonald',
          'kfc',
          'hungry jack',
          'dominos',
          'uber eats',
          'menulog',
        ],
      },
      {
        category: 'home',
        keywords: [
          'bunnings',
          'ikea',
          'bedroom',
          'homewares',
          'harvey norman',
          'the good guys',
          'jb hi-fi',
          'officeworks',
        ],
      },
      {
        category: 'fashion',
        keywords: [
          'cotton on',
          'country road',
          'target',
          'kmart',
          'myer',
          'david jones',
          'uniqlo',
          'fashion',
          'apparel',
        ],
      },
      {
        category: 'entertainment',
        keywords: [
          'netflix',
          'spotify',
          'steam',
          'playstation',
          'xbox',
          'cinema',
          'movie',
          'entertainment',
          'ticket',
          'rebel',
        ],
      },
    ];
    for (const rule of rules) {
      if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
        return rule.category;
      }
    }
    return 'other';
  }

  private async getOrCreateActiveCart(
    userId: string,
  ): Promise<PerksCartDocument> {
    const objectId = this.toObjectId(userId);
    const existing = await this.cartModel.findOne({
      userId: objectId,
      status: {
        $in: [PerksCartStatus.ACTIVE, PerksCartStatus.CHECKING_OUT],
      },
    });
    if (existing) {
      if (existing.status === PerksCartStatus.CHECKING_OUT) {
        existing.status = PerksCartStatus.ACTIVE;
        await existing.save();
      }
      return existing;
    }
    try {
      return await this.cartModel.create({
        userId: objectId,
        status: PerksCartStatus.ACTIVE,
        items: [],
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }
      const concurrent = await this.cartModel.findOne({
        userId: objectId,
        status: PerksCartStatus.ACTIVE,
      });
      if (!concurrent) {
        throw new ConflictException('Could not create an active cart');
      }
      return concurrent;
    }
  }

  private async releaseCartForRetry(cart: PerksCartDocument) {
    cart.status = PerksCartStatus.ACTIVE;
    await cart.save();
  }

  private cartResponse(cart: {
    _id?: unknown;
    status: PerksCartStatus;
    items: Array<{
      itemId: string;
      ecardId: string;
      quantity: number;
      faceValueCents: number;
      sendAsGift: boolean;
      gift: Record<string, string> | null;
    }>;
    updatedAt?: Date;
  }) {
    return {
      id: cart._id ? String(cart._id) : null,
      status: cart.status,
      items: cart.items.map((item) => ({
        itemId: item.itemId,
        ecardId: item.ecardId,
        quantity: item.quantity,
        ecardValue: this.currency(item.faceValueCents),
        sendAsGift: item.sendAsGift,
        gift: item.gift,
      })),
      updatedAt: cart.updatedAt ?? null,
    };
  }

  private async buildCartQuote(cart: {
    items: Array<{
      itemId: string;
      ecardId: string;
      quantity: number;
      faceValueCents: number;
      sendAsGift: boolean;
      gift: Record<string, string> | null;
    }>;
  }) {
    const cards = await this.getCachedCatalogue();
    const byId = new Map(cards.map((card) => [card.id, card]));
    const items = cart.items.map((item) => {
      const card = byId.get(item.ecardId);
      if (!card) {
        throw new UnprocessableEntityException(
          `Card ${item.ecardId} is no longer available`,
        );
      }
      this.assertCardValue(card, this.currency(item.faceValueCents));
      return this.quoteLine(item, card);
    });
    return {
      currency: 'AUD',
      items,
      totals: {
        faceValueCents: items.reduce(
          (sum, item) => sum + item.faceValueCents,
          0,
        ),
        purchasePriceCents: items.reduce(
          (sum, item) => sum + item.purchasePriceCents,
          0,
        ),
        deliveryFeeCents: items.reduce(
          (sum, item) => sum + item.deliveryFeeCents,
          0,
        ),
        totalCents: items.reduce((sum, item) => sum + item.totalCents, 0),
      },
    };
  }

  private quoteLine(
    item: {
      itemId: string;
      ecardId: string;
      quantity: number;
      faceValueCents: number;
    },
    card: CatalogueCard,
  ) {
    const unitPurchasePriceCents = Math.max(
      0,
      Math.round(
        item.faceValueCents * (1 - Math.max(0, card.discountPercent) / 100),
      ),
    );
    const deliveryFeeCents =
      Math.round(Math.max(0, card.deliveryFee) * 100) * item.quantity;
    return {
      itemId: item.itemId,
      ecardId: item.ecardId,
      ecardName: card.name,
      ecardImageUrl: card.imageUrl,
      quantity: item.quantity,
      discountBps: Math.round(card.discountPercent * 100),
      faceValueCents: item.faceValueCents * item.quantity,
      purchasePriceCents: unitPurchasePriceCents * item.quantity,
      deliveryFeeCents,
      totalCents: unitPurchasePriceCents * item.quantity + deliveryFeeCents,
    };
  }

  private assertCardValue(card: CatalogueCard, value: number) {
    if (
      card.availableValues.length > 0 &&
      !card.availableValues.some(
        (available) => Math.round(available * 100) === Math.round(value * 100),
      )
    ) {
      throw new UnprocessableEntityException(
        `Value is not available for ${card.name}`,
      );
    }
  }

  private mapCartOrderPayload(
    item: {
      ecardId: string;
      faceValueCents: number;
      quantity: number;
      sendAsGift: boolean;
      gift: Record<string, string> | null;
    },
    orderReference: string,
  ) {
    return {
      ecard_id: item.ecardId,
      ecard_value: this.currency(item.faceValueCents),
      ecard_qty: item.quantity,
      order_reference: orderReference,
      ecard_sendasgift: item.sendAsGift ? 1 : 0,
      ...(item.sendAsGift
        ? {
            gift_templateid: item.gift?.templateId,
            gift_recipient_name: item.gift?.recipientName,
            gift_recipient_email: item.gift?.recipientEmail,
          }
        : {}),
    };
  }

  private isIssuanceEnabled() {
    const value = this.config.get<string | boolean>(
      'PERKS_ORDER_ISSUANCE_ENABLED',
      false,
    );
    return value === true || String(value).toLowerCase() === 'true';
  }

  private assertIssuanceEnabled() {
    if (!this.isIssuanceEnabled()) {
      throw new ServiceUnavailableException({
        message: 'Perks order issuance is disabled',
        code: 'PERKS_ORDER_ISSUANCE_DISABLED',
      });
    }
  }

  private profileMissingFields(
    user: Pick<User, 'name' | 'pincode' | 'gender' | 'phoneNumber'>,
    fallbackGender?: Gender | null,
  ) {
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    const postcode = (user.pincode ?? '').trim();
    const missingFields: string[] = [];
    if (nameParts.length < 2) {
      missingFields.push('name');
    }
    if (!/^\d{4,}$/.test(postcode)) {
      missingFields.push('pincode');
    }
    // Gender is optional in WMAD docs, but incomplete Saveful profiles are a
    // common reject cause, so require it before calling upstream.
    if (!user.gender && !fallbackGender) {
      missingFields.push('gender');
    }
    return missingFields;
  }

  private mapRegistration(user: User, fallbackGender?: Gender | null) {
    const nameParts = user.name.trim().split(/\s+/).filter(Boolean);
    const postcode = (user.pincode ?? '').trim();
    const missingFields = this.profileMissingFields(user, fallbackGender);
    if (missingFields.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Complete your Saveful profile before using Perks',
        missingFields,
      });
    }
    const gender = this.toWmadGenderCode(user.gender ?? fallbackGender ?? null);
    const registration: {
      firstname: string;
      lastname: string;
      email: string;
      postcode: string;
      phone?: string;
      gender: WmadGenderCode;
    } = {
      firstname: nameParts[0],
      lastname: nameParts.slice(1).join(' '),
      email: user.email.toLowerCase(),
      // WMAD only accepts 4-digit postcodes, so keep Saveful's stored pincode
      // intact and trim only the upstream registration payload.
      postcode: postcode.slice(0, 4),
      gender: gender as WmadGenderCode,
    };
    const phone = this.toWmadPhoneNumber(user.phoneNumber);
    if (phone) {
      registration.phone = phone;
    }
    return registration;
  }

  private mapOrderPayload(
    dto: CreatePerksOrderDto,
    orderReference: string,
  ): Record<string, unknown> {
    return {
      ecard_id: dto.ecardId,
      ecard_value: dto.ecardValue,
      ecard_qty: dto.quantity,
      order_reference: orderReference,
      ecard_sendasgift: dto.sendAsGift ? 1 : 0,
      ...(dto.sendAsGift
        ? {
            gift_templateid: dto.giftTemplateId,
            gift_recipient_name: dto.giftRecipientName,
            gift_recipient_email: dto.giftRecipientEmail,
          }
        : {}),
      ...(dto.giftRecipientPhone
        ? { gift_recipient_phone: dto.giftRecipientPhone }
        : {}),
      ...(dto.giftUseCode ? { gift_usecode: dto.giftUseCode } : {}),
      ...(dto.giftReferenceNumber
        ? { gift_refnumber: dto.giftReferenceNumber }
        : {}),
      ...(dto.giftCategory ? { gift_category: dto.giftCategory } : {}),
      ...(dto.giftSubcategory ? { gift_subcategory: dto.giftSubcategory } : {}),
      ...(dto.giftConsultantName
        ? { gift_consultant_name: dto.giftConsultantName }
        : {}),
      ...(dto.giftConsultantEmail
        ? { gift_consultant_email: dto.giftConsultantEmail }
        : {}),
    };
  }

  private applyOrderResult(order: PerksOrderDocument, result: WmadOrderResult) {
    order.wmadOrderNumber = String(result.order_number);
    order.status = this.mapOrderStatus(result.order_status);
    order.cardUrl = result.cardurl ?? null;
  }

  private mapOrderStatus(status: unknown): PerksOrderStatus {
    switch (String(status)) {
      case '1':
        return PerksOrderStatus.PROCESSING;
      case '2':
        return PerksOrderStatus.COMPLETED;
      case '5':
        return PerksOrderStatus.REFUNDED;
      case '6':
        return PerksOrderStatus.FAILED;
      default:
        return PerksOrderStatus.UNKNOWN;
    }
  }

  private async findOwnedOrder(userId: string, orderNumber: string) {
    if (!/^\d+$/.test(orderNumber)) {
      throw new BadRequestException('Invalid order number');
    }
    const order = await this.orderModel.findOne({
      userId: this.toObjectId(userId),
      wmadOrderNumber: orderNumber,
    });
    if (!order) {
      throw new NotFoundException('Perks order not found');
    }
    return order;
  }

  private mapWalletEntry(entry: Record<string, unknown>, gifted: boolean) {
    const orderNumber = this.nullableString(entry.order_number);
    const orderReference = this.nullableString(entry.order_reference);
    const cardName = this.stringValue(entry.ecard_name);
    const issuedAt =
      this.nullableString(entry.ecard_issuedate) ??
      this.nullableString(entry.card_senddate);
    const cardKey = createHash('sha256')
      .update(
        [
          gifted ? 'gifted' : 'owned',
          orderNumber ?? '',
          orderReference ?? '',
          this.stringValue(entry.ecard_id),
          cardName,
          issuedAt ?? '',
          this.stringValue(
            entry.ecard_number ?? entry.card_number ?? entry.cardno,
          ),
        ].join('|'),
      )
      .digest('hex');
    return {
      cardKey,
      gifted,
      cardName,
      value: this.numberValue(entry.ecard_value),
      issuedAt,
      expiresIn: this.nullableString(entry.ecard_expiry),
      orderReference,
      orderNumber,
      orderStatus: this.mapOrderStatus(entry.order_status),
      cardUrl: this.nullableString(entry.cardurl ?? entry.card_url),
      cardNumber: this.nullableString(
        entry.ecard_number ?? entry.card_number ?? entry.cardno,
      ),
      pin: this.nullableString(
        entry.ecard_pin ?? entry.card_pin ?? entry.cardpin,
      ),
      barcode: this.nullableString(entry.ecard_barcode ?? entry.barcode),
      balance: this.numberValue(entry.ecard_balance ?? entry.card_balance),
      ...(gifted
        ? {
            recipientName: this.nullableString(entry.recipient_name),
            recipientEmail: this.nullableString(entry.recipient_email),
            cardOpenedAt: this.nullableString(entry.card_openip),
            linkOpenedAt: this.nullableString(entry.card_linkopendate),
          }
        : {}),
    };
  }

  private validateCardKey(cardKey: string) {
    if (!/^[a-f0-9]{64}$/.test(cardKey)) {
      throw new BadRequestException('Invalid wallet card key');
    }
  }

  private findCategory(value: string) {
    const normalized = value.trim().toLowerCase();
    const aliased = PERKS_CATEGORY_ALIASES[normalized] ?? normalized;
    const category = PERKS_CATEGORIES.find(
      (item) =>
        item.key === aliased ||
        item.key === normalized ||
        item.name.toLowerCase() === normalized,
    );
    if (!category) {
      throw new BadRequestException(`Unknown Perks category: ${value}`);
    }
    return category;
  }

  private savings(annualCents: number) {
    return {
      annual: this.currency(annualCents),
      monthly: this.currency(Math.round(annualCents / 12)),
      weekly: this.currency(Math.round(annualCents / 52)),
    };
  }

  private currency(cents: number) {
    return Number((cents / 100).toFixed(2));
  }

  private cardImageUrl(value: unknown): string | null {
    const filename = this.safeImageFilename(value);
    return filename
      ? `https://www.wemad.com.au/upload/ecards/${encodeURIComponent(filename)}`
      : null;
  }

  private safeImageFilename(value: unknown): string | null {
    const filename = this.nullableString(value);
    if (
      !filename ||
      filename.includes('..') ||
      !/^[A-Za-z0-9._-]+$/.test(filename)
    ) {
      return null;
    }
    return filename;
  }

  private parseCardValues(value: unknown): number[] {
    return this.stringValue(value)
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part) && part > 0);
  }

  private arrayValue(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object',
        )
      : [];
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private stringValue(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  private nullableString(value: unknown): string | null {
    const result = this.stringValue(value).trim();
    return !result || result.toLowerCase() === 'null' ? null : result;
  }

  private toWmadPhoneNumber(value: unknown): string | null {
    const digits = this.stringValue(value).replace(/\D+/g, '');
    return digits.length >= 8 && digits.length <= 11 ? digits : null;
  }

  private toWmadGenderCode(value: unknown): WmadGenderCode | null {
    switch (this.nullableString(value)?.toLowerCase()) {
      case Gender.MALE:
        return 0;
      case Gender.FEMALE:
        return 1;
      case Gender.OTHER:
        return 2;
      default:
        return null;
    }
  }

  private numberValue(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private membershipResponse(membership: {
    wmadUserId?: string | null;
    status: PerksMembershipStatus;
    registeredAt?: Date | null;
  }) {
    return {
      wmadUserId: membership.wmadUserId ?? null,
      status: membership.status,
      registeredAt: membership.registeredAt ?? null,
    };
  }

  private orderResponse(order: {
    orderReference: string;
    wmadOrderNumber?: string | null;
    status: PerksOrderStatus;
    cardUrl?: string | null;
    receiptUrl?: string | null;
    currency?: string;
    faceValueCents?: number;
    purchasePriceCents?: number;
    deliveryFeeCents?: number;
    totalCents?: number;
    completedAt?: Date | null;
    lines?: Array<{
      lineId: string;
      ecardId: string;
      ecardName: string;
      ecardImageUrl?: string | null;
      quantity: number;
      discountBps: number;
      faceValueCents: number;
      purchasePriceCents: number;
      deliveryFeeCents: number;
      totalCents: number;
      status: PerksOrderStatus;
      orderReference: string;
      wmadOrderNumber?: string | null;
      cardUrl?: string | null;
    }>;
    createdAt?: Date;
  }) {
    return {
      orderReference: order.orderReference,
      orderNumber: order.wmadOrderNumber ?? null,
      status: order.status,
      cardUrl: order.cardUrl ?? null,
      receiptUrl: order.receiptUrl ?? null,
      currency: order.currency ?? 'AUD',
      totals: {
        faceValue: this.currency(order.faceValueCents ?? 0),
        purchasePrice: this.currency(order.purchasePriceCents ?? 0),
        deliveryFee: this.currency(order.deliveryFeeCents ?? 0),
        total: this.currency(order.totalCents ?? 0),
      },
      lines: (order.lines ?? []).map((line) => ({
        lineId: line.lineId,
        ecardId: line.ecardId,
        ecardName: line.ecardName,
        ecardImageUrl: line.ecardImageUrl ?? null,
        quantity: line.quantity,
        discountPercent: line.discountBps / 100,
        faceValue: this.currency(line.faceValueCents),
        purchasePrice: this.currency(line.purchasePriceCents),
        deliveryFee: this.currency(line.deliveryFeeCents),
        total: this.currency(line.totalCents),
        status: line.status,
        orderReference: line.orderReference,
        orderNumber: line.wmadOrderNumber ?? null,
        cardUrl: line.cardUrl ?? null,
      })),
      createdAt: order.createdAt ?? null,
      completedAt: order.completedAt ?? null,
    };
  }

  private createOrderReference(userId: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(5).toString('hex').toUpperCase();
    const user = userId.slice(-6).toUpperCase();
    return `SV${timestamp}${user}${random}`;
  }

  private validateIdempotencyKey(value: string) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value ?? '')) {
      throw new BadRequestException(
        'Idempotency-Key must be 8-128 letters, numbers, underscores, or hyphens',
      );
    }
  }

  private toObjectId(userId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    return new Types.ObjectId(userId);
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private asApiError(error: unknown): PerksApiError {
    if (error instanceof PerksApiError) {
      return error;
    }
    return new PerksApiError(
      'Unexpected WMAD integration error',
      502,
      'UNEXPECTED_UPSTREAM_ERROR',
      false,
      false,
    );
  }

  private async callUpstream<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.throwUpstream(this.asApiError(error));
    }
  }

  private throwUpstream(error: PerksApiError, prefix?: string): never {
    const message = prefix ? `${prefix}: ${error.message}` : error.message;
    if (error.retryable) {
      throw new ServiceUnavailableException({
        message,
        code: error.code,
        ambiguous: error.ambiguous,
      });
    }
    if (error.statusCode >= 400 && error.statusCode < 500) {
      throw new HttpException({ message, code: error.code }, error.statusCode);
    }
    throw new BadGatewayException({ message, code: error.code });
  }
}
