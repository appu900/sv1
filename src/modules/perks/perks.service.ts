import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
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
  PerksMembershipEvent,
  PerksMembershipEventDocument,
  PerksMembershipEventType,
} from '../../database/schemas/perks-membership-event.schema';
import {
  PerksMembership,
  PerksMembershipDocument,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../database/schemas/perks-membership.schema';
import {
  PerksWalletMetadata,
  PerksWalletMetadataDocument,
} from '../../database/schemas/perks-wallet-metadata.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { RedisService } from '../../redis/redis.service';
import { cacheAttempt } from './corp/cache';
import { toWemadPhone } from './corp/phone';
import {
  PerksCorpApiClient,
  PerksCorpApiError,
} from './corp/perks-corp-api.client';
import { PerksBillingService } from './billing/perks-billing.service';
import { PerksCorpSessionService } from './corp/perks-corp-session.service';
import {
  CatalogueCard,
  buildCategoryParentIndex,
  mapCatalogueCard,
  mapCategoryTree,
  mapGiftTemplates,
  mapOrder,
  mapWalletCard,
  OrderCardLookup,
  nullableStr,
  str,
} from './corp/perks-corp.mapper';
import {
  AddPerksFavouriteDto,
  CalculatePerksDto,
  CancelPerksMembershipDto,
  PerksCartItemDto,
  PerksCatalogueQueryDto,
  PerksCatalogueSort,
  PerksOrderListQueryDto,
  PerksSpendFrequency,
  QuotePerksDto,
  UpdatePerksCartItemDto,
} from './dto/perks.dto';

export type { CatalogueCard } from './corp/perks-corp.mapper';

const CATALOGUE_CACHE_VERSION = 'v6';

export const PERKS_CATEGORIES = [
  { key: 'groceries', name: 'Groceries', discountBps: 450 },
  { key: 'fuel', name: 'Fuel', discountBps: 200 },
  { key: 'pharmacy', name: 'Pharmacy, Health & Beauty', discountBps: 500 },
  { key: 'dining', name: 'Dining out', discountBps: 500 },
  { key: 'entertainment', name: 'Entertainment', discountBps: 500 },
  { key: 'fashion', name: 'Clothes & Fashion', discountBps: 500 },
  { key: 'hardware', name: 'Hardware & auto', discountBps: 500 },
  { key: 'beer-wine', name: 'Beer & Wine', discountBps: 500 },
  { key: 'travel', name: 'Travel & Accommodation', discountBps: 1000 },
] as const;

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

interface CartLikeItem {
  itemId: string;
  ecardId: string;
  quantity: number;
  faceValueCents: number;
  sendAsGift: boolean;
  gift: Record<string, string> | null;
}

@Injectable()
export class PerksService {
  private readonly logger = new Logger(PerksService.name);
  private catalogueRefreshPromise: Promise<CatalogueCard[]> | null = null;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(HealthProfile.name)
    private readonly healthProfileModel: Model<HealthProfileDocument>,
    @InjectModel(PerksMembership.name)
    private readonly membershipModel: Model<PerksMembershipDocument>,
    @InjectModel(PerksMembershipEvent.name)
    private readonly membershipEventModel: Model<PerksMembershipEventDocument>,
    @InjectModel(PerksFavourite.name)
    private readonly favouriteModel: Model<PerksFavouriteDocument>,
    @InjectModel(PerksCart.name)
    private readonly cartModel: Model<PerksCartDocument>,
    @InjectModel(PerksWalletMetadata.name)
    private readonly walletMetadataModel: Model<PerksWalletMetadataDocument>,
    @InjectModel(PerksCalculatorProfile.name)
    private readonly calculatorProfileModel: Model<PerksCalculatorProfileDocument>,
    private readonly api: PerksCorpApiClient,
    private readonly session: PerksCorpSessionService,
    private readonly billing: PerksBillingService,
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
    const usable = membership && !this.isLegacyMembership(membership);
    const status = usable
      ? this.membershipResponse(membership)
      : this.notRegisteredResponse();
    return {
      ...status,
      billing: this.billing.describe(user, usable ? membership : null),
      missingFields: this.session.missingProfileFields(
        user,
        (healthProfile?.gender as Gender | undefined) ?? null,
      ),
    };
  }


  async ensureMembership(userId: string) {
    const objectId = this.toObjectId(userId);
    const existing = await this.membershipModel.findOne({ userId: objectId });
    const legacy = existing ? this.isLegacyMembership(existing) : false;

    const { user, fallbackGender } = await this.loadUserProfile(objectId);

    if (this.billing.entitlementFor(user, existing).paymentRequired) {
      // Last check with Stripe before telling a member they have not paid: if
      // their webhook was lost, the money is gone and only Stripe knows.
      const reconciled = existing
        ? await this.billing.reconcileFromStripe(existing)
        : false;
      if (!reconciled) {
        throw new HttpException(
          {
            message: 'Perks membership requires payment to continue.',
            code: 'PERKS_PAYMENT_REQUIRED',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    if (existing?.status === PerksMembershipStatus.ACTIVE && !legacy) {
      return this.membershipResponse(existing.toObject());
    }
    if (existing?.status === PerksMembershipStatus.CANCELLED && !legacy) {
      throw new ConflictException({
        message:
          'Your Perks membership was cancelled. Resume it to start using Perks again.',
        code: 'PERKS_MEMBERSHIP_CANCELLED',
      });
    }

    const membership =
      existing ??
      (await this.membershipModel
        .create({
          userId: objectId,
          email: user.email.toLowerCase(),
          status: PerksMembershipStatus.PENDING,
        })
        .catch(async (error) => {
          if (!this.isDuplicateKey(error)) throw error;
          const concurrent = await this.membershipModel.findOne({
            userId: objectId,
          });
          if (!concurrent) {
            throw new ConflictException(
              'Perks registration is already in progress',
            );
          }
          return concurrent;
        }));

    return this.registerUpstream(userId, membership, user, fallbackGender);
  }

 
  async completeRegistrationAfterPayment(userId: string) {
    const objectId = this.toObjectId(userId);
    const membership = await this.membershipModel.findOne({ userId: objectId });
    if (!membership) {
      throw new NotFoundException('Perks membership not found');
    }
    if (membership.status === PerksMembershipStatus.ACTIVE) {
      const resumed = await this.billing.resumeSubscription(userId);
      if (resumed) {
        await this.recordEvent(objectId, PerksMembershipEventType.RESUMED, null);
        return this.membershipResponse(resumed.toObject());
      }
      return this.membershipResponse(membership.toObject());
    }

    const { user, fallbackGender } = await this.loadUserProfile(objectId);

    if (this.billing.entitlementFor(user, membership).paymentRequired) {
      const reconciled = await this.billing.reconcileFromStripe(membership);
      if (!reconciled) {
        throw new HttpException(
          {
            message: 'Perks membership requires payment to continue.',
            code: 'PERKS_PAYMENT_REQUIRED',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }
    return this.registerUpstream(userId, membership, user, fallbackGender);
  }

  private async registerUpstream(
    userId: string,
    membership: PerksMembershipDocument,
    user: User,
    fallbackGender: Gender | null,
  ) {
    const objectId = this.toObjectId(userId);
    try {
      const session = await this.session.login(userId, user, {
        credentialVersion: membership.credentialVersion ?? 1,
        fallbackGender,
      });
      membership.wmadUserId = session.wmadUserId;
      membership.wmadEmail = user.email.toLowerCase();
      membership.status = PerksMembershipStatus.ACTIVE;
      membership.registeredAt = membership.registeredAt ?? new Date();
      membership.lastErrorCode = null;
      membership.lastErrorMessage = null;
      await membership.save();

      await this.recordEvent(objectId, PerksMembershipEventType.REGISTERED, {
        wmadUserId: session.wmadUserId,
      });
      return this.membershipResponse(membership.toObject());
    } catch (error) {
      const code =
        error instanceof PerksCorpApiError
          ? error.code
          : ((error as HttpException)?.getStatus?.() ?? 'REGISTRATION_FAILED');
      membership.status = PerksMembershipStatus.FAILED;
      membership.lastErrorCode = String(code);
      // `explainLoginFailure` replaces WeMAD's wording with something a member
      // can act on, and carries the original as `upstreamMessage`. Persist that
      // instead: our own sentence tells support nothing they did not know, and
      // WeMAD's is the only text that says which field they rejected.
      membership.lastErrorMessage =
        this.upstreamMessageOf(error) ?? (error as Error)?.message ?? null;
      await membership.save();

      await this.recordEvent(
        objectId,
        PerksMembershipEventType.REGISTRATION_FAILED,
        { message: membership.lastErrorMessage },
      );
      throw error;
    }
  }

  async cancelMembership(userId: string, dto: CancelPerksMembershipDto) {
    const objectId = this.toObjectId(userId);
    const membership = await this.membershipModel.findOne({ userId: objectId });
    if (!membership) {
      throw new NotFoundException('Perks membership not found');
    }
    if (membership.status === PerksMembershipStatus.CANCELLED) {
      return this.membershipResponse(membership.toObject());
    }

    const reason = dto?.reason?.trim() || null;

    const scheduled = await this.billing.scheduleCancellation(userId, reason);
    if (scheduled) {
      await this.recordEvent(objectId, PerksMembershipEventType.CANCELLED, {
        reason,
        accessEndsAt: scheduled.accessEndsAt,
        immediate: false,
      });
      return this.membershipResponse(scheduled.toObject());
    }

    membership.status = PerksMembershipStatus.CANCELLED;
    membership.cancelledAt = new Date();
    membership.cancellationReason = reason;
    await membership.save();

    await this.session.clearCachedToken(userId);
    await this.releaseCart(objectId);

    await this.recordEvent(objectId, PerksMembershipEventType.CANCELLED, {
      reason: membership.cancellationReason,
      immediate: true,
    });
    return this.membershipResponse(membership.toObject());
  }

  async resumeMembership(userId: string) {
    const objectId = this.toObjectId(userId);
    const membership = await this.membershipModel.findOne({ userId: objectId });
    if (!membership) {
      throw new NotFoundException('Perks membership not found');
    }
    if (membership.status === PerksMembershipStatus.ACTIVE) {
      return this.membershipResponse(membership.toObject());
    }

    const { user, fallbackGender } = await this.loadUserProfile(objectId);
    const session = await this.session.login(userId, user, {
      credentialVersion: membership.credentialVersion ?? 1,
      fallbackGender,
    });

    membership.status = PerksMembershipStatus.ACTIVE;
    membership.wmadUserId = session.wmadUserId;
    membership.cancelledAt = null;
    membership.cancellationReason = null;
    membership.lastErrorCode = null;
    membership.lastErrorMessage = null;
    await membership.save();

    await this.recordEvent(objectId, PerksMembershipEventType.RESUMED, null);
    return this.membershipResponse(membership.toObject());
  }

  async listMembershipEvents(userId: string, limit = 50) {
    const events = await this.membershipEventModel
      .find({ userId: this.toObjectId(userId) })
      .sort({ at: -1 })
      .limit(Math.min(200, Math.max(1, limit)))
      .lean();
    return events.map((event) => ({
      type: event.type,
      at: event.at ?? null,
      metadata: event.metadata ?? null,
    }));
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
    cards = [...cards].sort((left, right) => {
      if (query.sort === PerksCatalogueSort.DISCOUNT_DESC) {
        return right.discountPercent - left.discountPercent;
      }
      if (query.sort === PerksCatalogueSort.DISCOUNT_ASC) {
        return left.discountPercent - right.discountPercent;
      }
      return left.name.localeCompare(right.name);
    });
    return cards.map(
      ({ description: _description, terms: _terms, ...card }) => card,
    );
  }

  async getCategories() {
    const cacheKey = `perks:corp:categories:${CATALOGUE_CACHE_VERSION}`;
    const cached = await cacheAttempt(() =>
      this.redis.get<ReturnType<typeof mapCategoryTree>>(cacheKey),
    );
    if (cached) return cached;

    const raw = await this.callUpstream(() => this.api.getCategories());
    const tree = mapCategoryTree(raw).filter((group) => group.name);
    await cacheAttempt(() => this.redis.set(cacheKey, tree, this.catalogueTtl()));
    return tree;
  }

  async getCatalogueCard(ecardId: string) {
    if (!/^\d+$/.test(ecardId)) {
      throw new BadRequestException('Invalid ecard ID');
    }
    const cacheKey = `perks:corp:card:${CATALOGUE_CACHE_VERSION}:${ecardId}`;
    const cached = await cacheAttempt(() =>
      this.redis.get<CatalogueCard>(cacheKey),
    );
    if (cached) return cached;

    const detail = await this.callUpstream(() => this.api.getGiftCard(ecardId));
    const giftCard = (detail?.gift_card ?? detail) as Record<string, unknown>;
    if (!giftCard || !giftCard.id) {
      throw new NotFoundException('Perks card not found');
    }
    const card = mapCatalogueCard(giftCard, undefined, { detailed: true });

    await cacheAttempt(() => this.redis.set(cacheKey, card, this.catalogueTtl()));
    return card;
  }


  async getGiftOptions(userId: string, ecardId?: string) {
    await this.requireActiveMembership(userId);

    let requested = ecardId;
    if (!requested) {
      const [firstCard] = await this.getCachedCatalogue();
      requested = firstCard?.id;
    }
    if (!requested) {
      return { templates: [], consultants: [], categories: [], subcategories: [] };
    }
    const targetId = requested;
    const detail = await this.callUpstream(() => this.api.getGiftCard(targetId));
    return {
      templates: mapGiftTemplates(detail ?? {}),
      consultants: [],
      categories: [],
      subcategories: [],
    };
  }


  async getFavourites(userId: string) {
    const objectId = this.toObjectId(userId);
    const favourites = await this.favouriteModel
      .find({ userId: objectId })
      .sort({ createdAt: -1 })
      .lean();
    if (favourites.length === 0) return [];

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
    const objectId = this.toObjectId(userId);
    const favourite = await this.favouriteModel.findOneAndUpdate(
      { userId: objectId, ecardId: dto.ecardId },
      { $setOnInsert: { userId: objectId, ecardId: dto.ecardId } },
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

  /**
   * A gift recipient's number in WeMAD's format, or a clear refusal.
   *
   * Checked where the gift is created rather than at checkout: WeMAD applies
   * the same nine-digit rule to `recipient_phone` as to the member's own, and
   * finding out after the whole gift form is filled in is the failure mode we
   * already fixed once for unbuyable cards.
   */
  private requireGiftPhone(value?: string | null): string | null {
    const phone = toWemadPhone(value);
    if (!phone) {
      throw new UnprocessableEntityException({
        message:
          'Enter an Australian mobile number for the person receiving this gift.',
        code: 'PERKS_GIFT_PHONE_NOT_SUPPORTED',
        fields: ['giftRecipientPhone'],
      });
    }
    return phone;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateActiveCart(userId);
    return this.cartResponse(cart.toObject());
  }

  async addCartItem(userId: string, dto: PerksCartItemDto) {
    await this.requireActiveMembership(userId);
    const card = await this.getCatalogueCard(dto.ecardId);
    this.assertCardValue(card, dto.ecardValue);
    const giftPhone = dto.sendAsGift
      ? this.requireGiftPhone(dto.giftRecipientPhone)
      : null;

    const cart = await this.getOrCreateActiveCart(userId);
    const faceValueCents = Math.round(dto.ecardValue * 100);
    const existing = cart.items.find(
      (item) =>
        item.ecardId === dto.ecardId &&
        item.faceValueCents === faceValueCents &&
        item.sendAsGift === Boolean(dto.sendAsGift),
    );
    if (existing) {
      existing.quantity = Math.min(100, existing.quantity + dto.quantity);
    } else {
      cart.items.push({
        itemId: randomUUID(),
        ecardId: dto.ecardId,
        quantity: dto.quantity,
        faceValueCents,
        sendAsGift: Boolean(dto.sendAsGift),
        gift: dto.sendAsGift
          ? {
              recipientName: dto.giftRecipientName!,
              recipientEmail: dto.giftRecipientEmail!,
              recipientPhone: giftPhone!,
              templateId: dto.giftTemplateId!,
              templateDesignId: dto.giftTemplateDesignId!,
              ...(dto.giftMessage ? { message: dto.giftMessage } : {}),
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
    await this.requireActiveMembership(userId);
    const cart = await this.getOrCreateActiveCart(userId);
    const item = cart.items.find((candidate) => candidate.itemId === itemId);
    if (!item) throw new NotFoundException('Cart item not found');

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
    const before = cart.items.length;
    cart.items = cart.items.filter((item) => item.itemId !== itemId);
    if (cart.items.length === before) {
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
                recipientPhone: this.requireGiftPhone(dto.giftRecipientPhone)!,
                templateId: dto.giftTemplateId!,
                templateDesignId: dto.giftTemplateDesignId!,
                ...(dto.giftMessage ? { message: dto.giftMessage } : {}),
              }
            : null,
        },
      ],
    });
  }


  async checkoutCart(userId: string) {
    const { user, membership } = await this.requireActiveMembership(userId);
    const cart = await this.getOrCreateActiveCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException(
        'Your cart is empty. Add a gift card before checking out.',
      );
    }

    const quote = await this.buildCartQuote(cart.toObject());

    const session = await this.session.login(userId, user, {
      credentialVersion: membership.credentialVersion ?? 1,
    });

    await this.syncCartUpstream(session.accessToken, cart.items);

    await this.recordEvent(
      this.toObjectId(userId),
      PerksMembershipEventType.CHECKOUT_STARTED,
      {
        itemCount: cart.items.length,
        totalCents: quote.totals.totalCents,
      },
    );

    const checkoutUrl = await this.session.createCheckoutUrl(session, user);

    return {
      status: 'redirect' as const,
      checkoutUrl,
      quote,
    };
  }

  private async syncCartUpstream(accessToken: string, items: CartLikeItem[]) {
    const existing = await this.callUpstream(() =>
      this.api.getCart(accessToken),
    );
    for (const row of existing) {
      const cartId = row?.id;
      if (cartId === undefined || cartId === null) continue;
      await this.callUpstream(() =>
        this.api.removeFromCart(accessToken, cartId as number | string),
      );
    }

    for (const item of items) {
      const line = {
        gift_card_id: item.ecardId,
        amount: this.currency(item.faceValueCents),
        purchase_type: item.sendAsGift ? ('gift' as const) : ('self' as const),
        // All five are mandatory upstream for a gift line; omitting the phone
        // or the design id fails the whole checkout with a 422.
        ...(item.sendAsGift && item.gift
          ? {
              recipient_name: item.gift.recipientName,
              recipient_email: item.gift.recipientEmail,
              // Normalised again here: carts saved before the nine-digit rule
              // was applied still hold the number exactly as it was typed.
              recipient_phone:
                toWemadPhone(item.gift.recipientPhone) ??
                item.gift.recipientPhone,
              gift_template_id: item.gift.templateId,
              gift_template_design_id: item.gift.templateDesignId,
              ...(item.gift.message ? { message: item.gift.message } : {}),
            }
          : {}),
      };
      for (let unit = 0; unit < item.quantity; unit += 1) {
        await this.callUpstream(() => this.api.addToCart(accessToken, line));
      }
    }

    const expected = items.reduce((sum, item) => sum + item.quantity, 0);
    const synced = await this.callUpstream(() => this.api.getCart(accessToken));
    if (synced.length < expected) {
      this.logger.error(
        `Perks cart sync incomplete: expected ${expected} upstream rows, found ${synced.length}`,
      );
      throw new BadGatewayException({
        message:
          'We could not prepare your checkout just now. Please try again in a moment.',
        code: 'PERKS_CART_SYNC_FAILED',
      });
    }
  }


  async listOrders(userId: string, query: PerksOrderListQueryDto) {
    const orders = await this.fetchOrders(userId);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    return {
      items: orders.slice(offset, offset + limit),
      total: orders.length,
      limit,
      offset,
    };
  }


  async getOrder(userId: string, orderNumber: string) {
    const orders = await this.fetchOrders(userId);
    const order = orders.find(
      (candidate) =>
        candidate.orderNumber === orderNumber ||
        candidate.orderReference === orderNumber,
    );
    if (!order) throw new NotFoundException('Perks order not found');
    return { ...order, upstream: { cardUrl: order.cardUrl } };
  }


  /**
   * WeMAD have no invoice endpoint yet; they are adding a link to the order
   * detail. Read it from the order so this starts returning a real receipt the
   * moment they ship, with no code change — until then it stays null and the
   * app shows its "receipt unavailable" message.
   */
  async getTaxReceipt(userId: string, orderNumber: string) {
    try {
      const order = await this.getOrder(userId, orderNumber);
      return {
        orderNumber: order.orderNumber ?? orderNumber,
        receiptUrl: order.receiptUrl ?? null,
      };
    } catch (error) {
      // A wallet card can reference an order id that the (paginated) order list
      // does not surface. "No receipt yet" is both true and useful here; a 404
      // would show the customer an error for a card they legitimately own.
      if (error instanceof NotFoundException) {
        this.logger.warn(
          `Perks tax receipt: order ${orderNumber} not found for this user`,
        );
        return { orderNumber, receiptUrl: null as string | null };
      }
      throw error;
    }
  }

  private async fetchOrders(userId: string) {
    const { user, membership } = await this.requireActiveMembership(userId);
    const payload = await this.callUpstream(() =>
      this.session.withAccessToken(
        userId,
        user,
        (token) => this.api.listOrders(token),
        { credentialVersion: membership.credentialVersion ?? 1 },
      ),
    );

    const list = Array.isArray(payload) ? payload : [];
    if (!list.length) return [];
    // Only the cards these orders actually reference.
    const cards = await this.cardLookup(
      list.flatMap((order) =>
        (Array.isArray((order as { order_item?: unknown[] }).order_item)
          ? ((order as { order_item: Record<string, unknown>[] }).order_item)
          : []
        ).map((item) => str(item.gift_card_id)),
      ),
      'orders',
    );

    return list.map((order) => mapOrder(order as Record<string, unknown>, cards));
  }


  /**
   * Card id → name, artwork and balance link, for the handful of cards actually
   * referenced by an order or wallet.
   *
   * Resolves each card individually (each is cached on its own) rather than
   * depending on the full 634-card catalogue being loadable. That fetch is slow
   * and can fail; when it did, every purchased card silently rendered as
   * "Gift card" with no image — which is what a customer sees after paying.
   * Failures are per card, so one bad id cannot blank the rest.
   */
  private async cardLookup(
    ids: Array<string | null | undefined>,
    context: string,
  ): Promise<OrderCardLookup> {
    const unique = [...new Set(ids.map((id) => str(id)).filter(Boolean))];
    const lookup: OrderCardLookup = new Map();
    if (!unique.length) return lookup;

    await Promise.all(
      unique.map(async (id) => {
        try {
          const card = await this.getCatalogueCard(id);
          lookup.set(id, {
            name: card.name,
            imageUrl: card.imageUrl,
            balanceLink: card.balanceLink,
          });
        } catch (error) {
          this.logger.warn(
            `Perks ${context} could not resolve card ${id}: ${
              (error as Error).message
            }`,
          );
        }
      }),
    );

    return lookup;
  }

  private async fetchWalletCards(userId: string) {
    const { user, membership } = await this.requireActiveMembership(userId);
    const objectId = this.toObjectId(userId);

    const entries = await this.callUpstream(() =>
      this.session.withAccessToken(
        userId,
        user,
        (token) => this.api.listMyGiftCards(token),
        { credentialVersion: membership.credentialVersion ?? 1 },
      ),
    );

    // WeMAD's wallet rows carry a gift_card_id but usually no brand name or
    // artwork, so join the catalogue exactly as orders do. Without it every
    // card renders as "eGift card" with a placeholder image.
    const cards = await this.cardLookup(
      entries.map((entry) =>
        str(
          entry.gift_card_id ??
            (entry.gift_card as Record<string, unknown> | undefined)?.id,
        ),
      ),
      'wallet',
    );
    const mapped = entries.map((entry) => mapWalletCard(entry, cards));

    // Look under both keys: rows saved before the key was made stable are
    // stored against the old hash, and dropping them would silently un-archive
    // cards people had already filed away.
    const metadata = await this.walletMetadataModel
      .find({
        userId: objectId,
        cardKey: {
          $in: [
            ...mapped.map((entry) => entry.cardKey),
            ...mapped.map((entry) => entry.legacyCardKey),
          ],
        },
      })
      .lean();
    const byKey = new Map(metadata.map((entry) => [entry.cardKey, entry]));

    await this.migrateWalletKeys(objectId, mapped, byKey);

    return mapped
      .map(({ legacyCardKey, ...entry }) => {
        const local = byKey.get(entry.cardKey) ?? byKey.get(legacyCardKey);
        return {
          ...entry,
          archived: local?.archived ?? false,
          archivedAt: local?.archivedAt ?? null,
          hidden: local?.hidden ?? false,
        };
      })
      .filter((entry) => !entry.hidden);
  }

  /**
   * Moves archive/hide rows from the old volatile key onto the stable one, so
   * the repair happens once rather than on every read. Skips any card that
   * already has a row under the new key — the unique index would reject it.
   */
  private async migrateWalletKeys(
    userId: Types.ObjectId,
    mapped: Array<{ cardKey: string; legacyCardKey: string }>,
    byKey: Map<string, unknown>,
  ) {
    const stale = mapped.filter(
      (entry) =>
        entry.legacyCardKey !== entry.cardKey &&
        byKey.has(entry.legacyCardKey) &&
        !byKey.has(entry.cardKey),
    );
    if (!stale.length) return;

    try {
      await this.walletMetadataModel.bulkWrite(
        stale.map((entry) => ({
          updateOne: {
            filter: { userId, cardKey: entry.legacyCardKey },
            update: { $set: { cardKey: entry.cardKey } },
          },
        })),
      );
      this.logger.log(
        `Migrated ${stale.length} perks wallet metadata row(s) to stable keys`,
      );
    } catch (error) {
      // Losing the migration is survivable — the fallback lookup above still
      // finds the row under its old key on every read.
      this.logger.warn(
        `Perks wallet key migration skipped: ${(error as Error).message}`,
      );
    }
  }

  async getWallet(
    userId: string,
    gifted: boolean,
    state: 'active' | 'archived' = 'active',
  ) {
    const cards = await this.fetchWalletCards(userId);
    return cards
      .filter(
        (card) =>
          card.gifted === gifted &&
          (state === 'archived' ? card.archived : !card.archived),
      )
      .map(({ hidden: _hidden, ...card }) => card);
  }

  async getWalletCard(userId: string, cardKey: string) {
    this.validateCardKey(cardKey);
    const cards = await this.fetchWalletCards(userId);
    const card = cards.find((entry) => entry.cardKey === cardKey);
    if (!card) throw new NotFoundException('Wallet card not found');
    const { hidden: _hidden, ...result } = card;
    return result;
  }

  async setWalletArchived(userId: string, cardKey: string, archived: boolean) {
    this.validateCardKey(cardKey);
    await this.getWalletCard(userId, cardKey);
    const objectId = this.toObjectId(userId);
    await this.walletMetadataModel.findOneAndUpdate(
      { userId: objectId, cardKey },
      {
        $set: {
          archived,
          archivedAt: archived ? new Date() : null,
          hidden: false,
        },
        $setOnInsert: { userId: objectId, cardKey },
      },
      { upsert: true, new: true },
    );
    return { cardKey, archived };
  }

  async hideWalletCard(userId: string, cardKey: string) {
    this.validateCardKey(cardKey);
    await this.getWalletCard(userId, cardKey);
    const objectId = this.toObjectId(userId);
    await this.walletMetadataModel.findOneAndUpdate(
      { userId: objectId, cardKey },
      { $set: { hidden: true }, $setOnInsert: { userId: objectId, cardKey } },
      { upsert: true },
    );
    return { cardKey, hidden: true };
  }

  async getDashboard(userId: string) {
    const objectId = this.toObjectId(userId);
    const [membership, favouriteCount, cart, calculator] = await Promise.all([
      this.membershipModel.findOne({ userId: objectId }).lean(),
      this.favouriteModel.countDocuments({ userId: objectId }),
      this.cartModel
        .findOne({ userId: objectId, status: PerksCartStatus.ACTIVE })
        .lean(),
      this.calculatorProfileModel.findOne({ userId: objectId }).lean(),
    ]);

    const activeMember =
      membership?.status === PerksMembershipStatus.ACTIVE &&
      !this.isLegacyMembership(membership);

 
    // Orders live upstream now; the dashboard must still render if WeMAD is
    // slow or down, so a failure here degrades to empty totals.
    let allOrders: Awaited<ReturnType<PerksService['fetchOrders']>> = [];
    if (activeMember) {
      try {
        allOrders = await this.fetchOrders(userId);
      } catch (error) {
        this.logger.warn(
          `Perks dashboard could not load orders: ${(error as Error).message}`,
        );
      }
    }
    const recentOrders = allOrders.slice(0, 5);
    const savings = this.summariseSavings(allOrders);

    return {
      membership:
        membership && !this.isLegacyMembership(membership)
          ? this.membershipResponse(membership)
          : this.notRegisteredResponse(),
      favouriteCount,
      cart: cart ? this.cartResponse(cart) : null,
      recentOrders,
      savings,
      latestCalculator: calculator
        ? {
            inputs: calculator.inputs,
            result: calculator.result,
            calculatedAt: calculator.calculatedAt,
          }
        : null,
    };
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
    const objectId = this.toObjectId(userId);
    await this.calculatorProfileModel.findOneAndUpdate(
      { userId: objectId },
      {
        $set: { inputs: dto.items, result, calculatedAt },
        $setOnInsert: { userId: objectId },
      },
      { upsert: true },
    );
    return { ...result, calculatedAt };
  }

  async getLatestCalculation(userId: string) {
    const profile = await this.calculatorProfileModel
      .findOne({ userId: this.toObjectId(userId) })
      .lean();
    if (!profile) return null;
    return {
      inputs: profile.inputs,
      result: profile.result,
      calculatedAt: profile.calculatedAt,
    };
  }

  private summariseSavings(
    orders: Awaited<ReturnType<PerksService['fetchOrders']>>,
  ) {
    let giftCardSavingsCents = 0;
    let cashbackBalanceCents = 0;

    for (const order of orders) {
      if (order.status === 'refunded' || order.status === 'failed') continue;
      const faceCents = Math.round((order.totals.faceValue ?? 0) * 100);
      const paidCents = Math.round((order.totals.purchasePrice ?? 0) * 100);
      giftCardSavingsCents += Math.max(0, faceCents - paidCents);
      cashbackBalanceCents += Math.round((order.totals.cashback ?? 0) * 100);
    }

    return {
      giftCardSavings: this.currency(giftCardSavingsCents),
      cashbackBalance: this.currency(cashbackBalanceCents),
      orderCount: orders.length,
    };
  }

  private async loadUserProfile(objectId: Types.ObjectId) {
    const [user, healthProfile] = await Promise.all([
      this.userModel.findById(objectId).lean(),
      this.healthProfileModel
        .findOne({ userId: objectId })
        .select({ gender: 1 })
        .lean(),
    ]);
    if (!user) throw new NotFoundException('Saveful user not found');
    return {
      user: user as User,
      fallbackGender: (healthProfile?.gender as Gender | undefined) ?? null,
    };
  }


  private async requireActiveMembership(userId: string) {
    const objectId = this.toObjectId(userId);
    const membership = await this.membershipModel
      .findOne({ userId: objectId })
      .lean();

    const usable =
      membership &&
      membership.status === PerksMembershipStatus.ACTIVE &&
      !this.isLegacyMembership(membership);

    if (!usable) {
      const cancelled =
        membership?.status === PerksMembershipStatus.CANCELLED &&
        !this.isLegacyMembership(membership);
      throw new ForbiddenException({
        message: cancelled
          ? 'Your Perks membership was cancelled. Resume it to continue.'
          : 'Join Perks to continue.',
        code: cancelled
          ? 'PERKS_MEMBERSHIP_CANCELLED'
          : 'PERKS_MEMBERSHIP_REQUIRED',
        status: cancelled ? membership!.status : 'not_registered',
      });
    }

    const { user } = await this.loadUserProfile(objectId);
    if (!this.billing.entitlementFor(user, membership).entitled) {
      throw new ForbiddenException({
        message: 'Your Perks membership has ended. Renew it to continue.',
        code: 'PERKS_PAYMENT_REQUIRED',
        status: membership!.status,
      });
    }

    return { user, membership };
  }

  private async recordEvent(
    userId: Types.ObjectId,
    type: PerksMembershipEventType,
    metadata: Record<string, unknown> | null,
  ) {
    try {
      await this.membershipEventModel.create({ userId, type, metadata });
    } catch (error) {
      this.logger.warn(
        `Could not record perks event ${type}: ${(error as Error).message}`,
      );
    }
  }

  private async releaseCart(userId: Types.ObjectId) {
    await this.cartModel.updateOne(
      {
        userId,
        status: { $in: [PerksCartStatus.ACTIVE, PerksCartStatus.CHECKING_OUT] },
      },
      { $set: { items: [], status: PerksCartStatus.ACTIVE } },
    );
  }

  private catalogueTtl() {
    return this.positiveConfigNumber('PERKS_CATALOGUE_CACHE_TTL_SECONDS', 300);
  }

  private async getCachedCatalogue(): Promise<CatalogueCard[]> {
    const cacheKey = `perks:corp:catalogue:${CATALOGUE_CACHE_VERSION}`;
    const cached = await cacheAttempt(() =>
      this.redis.get<CatalogueCard[]>(cacheKey),
    );
    if (cached) return cached;

    if (this.catalogueRefreshPromise) return this.catalogueRefreshPromise;

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
    const acquired = await cacheAttempt(() =>
      this.redis.setIfAbsent(lockKey, lockToken, lockTtlSeconds),
    );
    if (acquired === null) return this.fetchAndCacheCatalogue(cacheKey);

    let hasLock = acquired;
    if (!hasLock) {
      const waitMs = this.positiveConfigNumber(
        'PERKS_CATALOGUE_LOCK_WAIT_MS',
        16_000,
      );
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await this.delay(Math.min(250, Math.max(1, deadline - Date.now())));
        const cached = await cacheAttempt(() =>
          this.redis.get<CatalogueCard[]>(cacheKey),
        );
        if (cached) return cached;
        const retry = await cacheAttempt(() =>
          this.redis.setIfAbsent(lockKey, lockToken, lockTtlSeconds),
        );
        if (retry === null) return this.fetchAndCacheCatalogue(cacheKey);
        if (retry) {
          hasLock = true;
          break;
        }
      }
    }

    try {
      return await this.fetchAndCacheCatalogue(cacheKey);
    } finally {
      if (hasLock) {
        await cacheAttempt(() => this.redis.releaseLock(lockKey, lockToken));
      }
    }
  }

  private async fetchAndCacheCatalogue(
    cacheKey: string,
  ): Promise<CatalogueCard[]> {
    const paginate = this.positiveConfigNumber('PERKS_CATALOGUE_PAGE_SIZE', 100);
    const raw = await this.callUpstream(() =>
      this.api.listAllGiftCards({ pageSize: paginate }),
    );
    let parentIndex: ReturnType<typeof buildCategoryParentIndex> | undefined;
    try {
      parentIndex = buildCategoryParentIndex(await this.getCategories());
    } catch (error) {
      this.logger.warn(
        `Perks catalogue could not load categories: ${(error as Error).message}`,
      );
    }

    const cards = raw
      .map((card) => mapCatalogueCard(card, parentIndex))
      .filter((card) => Boolean(card.id && card.name));

    await cacheAttempt(() => this.redis.set(cacheKey, cards, this.catalogueTtl()));
    return cards;
  }

  private positiveConfigNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key, String(fallback)));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (!this.isDuplicateKey(error)) throw error;
      const concurrent = await this.cartModel.findOne({
        userId: objectId,
        status: PerksCartStatus.ACTIVE,
      });
      if (!concurrent) {
        throw new ConflictException(
        "We couldn't open your cart just now. Please try again.",
      );
      }
      return concurrent;
    }
  }

  private cartResponse(cart: {
    _id?: unknown;
    status: PerksCartStatus;
    items: CartLikeItem[];
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

  private async buildCartQuote(cart: { items: CartLikeItem[] }) {
    const items = await Promise.all(
      cart.items.map(async (item) => {
        const card = await this.getCatalogueCard(item.ecardId);
        try {
          this.assertCardValue(card, this.currency(item.faceValueCents));
        } catch (error) {
          throw this.describeCartLineFailure(error, item, card);
        }
        return this.quoteLine(item, card);
      }),
    );

    return {
      currency: 'AUD',
      items,
      totals: {
        faceValueCents: items.reduce((sum, item) => sum + item.faceValueCents, 0),
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

  private describeCartLineFailure(
    error: unknown,
    item: CartLikeItem,
    card: CatalogueCard,
  ) {
    if (!(error instanceof HttpException)) return error;
    const response = error.getResponse();
    const detail =
      typeof response === 'string' ? { message: response } : { ...(response as object) };

    return new UnprocessableEntityException({
      ...detail,
      code: 'PERKS_CART_LINE_UNAVAILABLE',
      itemId: item.itemId,
      ecardId: item.ecardId,
      ecardName: card.name,
    });
  }

  private quoteLine(
    item: { itemId: string; ecardId: string; quantity: number; faceValueCents: number },
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
    if (!Number.isFinite(value) || value <= 0) {
      throw new UnprocessableEntityException(
        `Enter a valid amount for ${card.name}.`,
      );
    }

    if (card.purchasable !== true) {
      throw new UnprocessableEntityException(
        `${card.name} is not available to buy yet. Our partner hasn't set up its pricing.`,
      );
    }

    if (card.variablePrice) {
      const min = card.minAmount ?? 0;
      const max = card.maxAmount ?? Number.POSITIVE_INFINITY;
      if (value < min || value > max) {
        throw new UnprocessableEntityException(
          `Choose an amount between $${min} and $${max} for ${card.name}.`,
        );
      }
      return;
    }

    if (
      card.availableValues.length > 0 &&
      !card.availableValues.some(
        (available) => Math.round(available * 100) === Math.round(value * 100),
      )
    ) {
      throw new UnprocessableEntityException(
        `$${value} is not available for ${card.name}. Choose one of the listed amounts.`,
      );
    }
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

  private isLegacyMembership(membership: { credentialVersion?: number | null }) {
    return membership.credentialVersion === undefined ||
      membership.credentialVersion === null;
  }

  private notRegisteredResponse() {
    return {
      wmadUserId: null,
      status: 'not_registered',
      registeredAt: null,
      plan: PerksMembershipPlan.FREE,
      cancelledAt: null,
      accessEndsAt: null,
      registrationErrorCode: null,
    };
  }

  private membershipResponse(membership: {
    wmadUserId?: string | null;
    status: PerksMembershipStatus;
    registeredAt?: Date | null;
    plan?: PerksMembershipPlan;
    cancelledAt?: Date | null;
    accessEndsAt?: Date | null;
    lastErrorCode?: string | null;
  }) {
    return {
      wmadUserId: membership.wmadUserId ?? null,
      status: membership.status,
      registeredAt: membership.registeredAt ?? null,
      plan: membership.plan ?? PerksMembershipPlan.FREE,
      cancelledAt: membership.cancelledAt ?? null,
      accessEndsAt: membership.accessEndsAt ?? null,
      // Why sign-up failed, so a member who has already paid is told what is
      // actually wrong instead of being asked to keep waiting for a payment
      // that landed long ago. Only our own error code travels — upstream
      // messages are not safe to show and have leaked stack traces before.
      registrationErrorCode:
        membership.status === PerksMembershipStatus.FAILED
          ? (membership.lastErrorCode ?? 'REGISTRATION_FAILED')
          : null,
    };
  }

  /** WeMAD's own error text, when the failure carries one. */
  private upstreamMessageOf(error: unknown): string | null {
    if (error instanceof PerksCorpApiError) return error.message;
    const response = (error as HttpException)?.getResponse?.();
    if (response && typeof response === 'object') {
      const upstream = (response as { upstreamMessage?: unknown }).upstreamMessage;
      if (typeof upstream === 'string' && upstream.trim()) return upstream;
    }
    return null;
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
      (error as { code: unknown }).code === 11000
    );
  }

  private async callUpstream<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.throwUpstream(this.asApiError(error));
    }
  }

  private asApiError(error: unknown): PerksCorpApiError {
    if (error instanceof PerksCorpApiError) return error;
    return new PerksCorpApiError(
      'Unexpected WeMAD integration error',
      502,
      'UNEXPECTED_UPSTREAM_ERROR',
      false,
      false,
    );
  }

  private throwUpstream(error: PerksCorpApiError, prefix?: string): never {
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
