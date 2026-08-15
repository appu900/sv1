import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
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
import {
  PerksCorpApiClient,
  PerksCorpApiError,
} from './corp/perks-corp-api.client';
import { PerksCorpSessionService } from './corp/perks-corp-session.service';
import {
  CatalogueCard,
  DEFAULT_DISCOUNT_TIER,
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

const CATALOGUE_CACHE_VERSION = 'v4';

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
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- membership

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
    const status =
      membership && !this.isLegacyMembership(membership)
        ? this.membershipResponse(membership)
        : this.notRegisteredResponse();
    return {
      ...status,
      missingFields: this.session.missingProfileFields(
        user,
        (healthProfile?.gender as Gender | undefined) ?? null,
      ),
    };
  }

  /**
   * Registers (first call) or re-authenticates the user with WeMAD.
   * Idempotent: an already-active membership short-circuits without a network
   * call. A cancelled membership is NOT auto-resumed — that needs an explicit
   * resume so we never silently re-subscribe someone.
   */
  async ensureMembership(userId: string) {
    const objectId = this.toObjectId(userId);
    const existing = await this.membershipModel.findOne({ userId: objectId });
    const legacy = existing ? this.isLegacyMembership(existing) : false;

    // A legacy record's `active` refers to the retired product, so it must not
    // short-circuit — fall through and register properly against the corp API.
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

    const { user, fallbackGender } = await this.loadUserProfile(objectId);

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
      membership.lastErrorMessage = (error as Error)?.message ?? null;
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

    membership.status = PerksMembershipStatus.CANCELLED;
    membership.cancelledAt = new Date();
    membership.cancellationReason = dto?.reason?.trim() || null;
    await membership.save();

    // Drop the cached upstream token so nothing can keep transacting.
    await this.session.clearCachedToken(userId);
    await this.releaseCart(objectId);

    await this.recordEvent(objectId, PerksMembershipEventType.CANCELLED, {
      reason: membership.cancellationReason,
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

  /**
   * The real WeMAD category tree (7 groups, ~50 leaves). The app previously
   * guessed categories from card names against a hardcoded list of 7; this is
   * the authoritative taxonomy instead.
   */
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
    const card = mapCatalogueCard(giftCard, this.discountTier());

    await cacheAttempt(() => this.redis.set(cacheKey, card, this.catalogueTtl()));
    return card;
  }


  async getGiftOptions(userId: string, ecardId?: string) {
    await this.requireActiveMembership(userId);

    let targetId = ecardId;
    if (!targetId) {
      const [firstCard] = await this.getCachedCatalogue();
      targetId = firstCard?.id;
    }
    if (!targetId) {
      return { templates: [], consultants: [], categories: [], subcategories: [] };
    }

    const detail = await this.callUpstream(() => this.api.getGiftCard(targetId));
    return {
      templates: mapGiftTemplates(detail ?? {}),
      // No corp equivalent — retained so the app's response shape is stable.
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

  // ---------------------------------------------------------------------- cart

  async getCart(userId: string) {
    const cart = await this.getOrCreateActiveCart(userId);
    return this.cartResponse(cart.toObject());
  }

  async addCartItem(userId: string, dto: PerksCartItemDto) {
    await this.requireActiveMembership(userId);
    const card = await this.getCatalogueCard(dto.ecardId);
    this.assertCardValue(card, dto.ecardValue);

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
                templateId: dto.giftTemplateId!,
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
      throw new BadRequestException('An active cart with items is required');
    }

    const quote = await this.buildCartQuote(cart.toObject());

    // A fresh login every time: web tokens are single-use, so a cached one
    // would drop the customer on a login page instead of their cart.
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

    return {
      status: 'redirect' as const,
      checkoutUrl: this.api.buildCheckoutUrl(session.webToken),
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
        ...(item.sendAsGift && item.gift
          ? {
              recipient_name: item.gift.recipientName,
              recipient_email: item.gift.recipientEmail,
              gift_template_id: item.gift.templateId,
            }
          : {}),
      };
      for (let unit = 0; unit < item.quantity; unit += 1) {
        await this.callUpstream(() => this.api.addToCart(accessToken, line));
      }
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

  /**
   * Resolved from the list rather than the detail endpoint: the list already
   * embeds order_item[], and it lets us match on either the display
   * order_number or the internal id without guessing which the app holds.
   */
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


  async getTaxReceipt(userId: string, orderNumber: string) {
    await this.requireActiveMembership(userId);
    return { orderNumber, receiptUrl: null as string | null };
  }

  private async fetchOrders(userId: string) {
    const { user, membership } = await this.requireActiveMembership(userId);
    // callUpstream must wrap the OUTSIDE of withAccessToken: it converts
    // PerksCorpApiError into HttpException, and withAccessToken's 401 retry
    // tests for PerksCorpApiError. Nested the other way the retry never fires
    // and a stale token 401s until its cache entry expires.
    const payload = await this.callUpstream(() =>
      this.session.withAccessToken(
        userId,
        user,
        (token) => this.api.listOrders(token),
        { credentialVersion: membership.credentialVersion ?? 1 },
      ),
    );

    const raw = (payload?.orders as Record<string, unknown>)?.data ?? payload;
    const list = Array.isArray(raw) ? raw : [];
    if (!list.length) return [];

    // Order items reference a gift card by id only, so join the catalogue to
    // give each line a name and image. Degrades to a placeholder if the
    // catalogue is unavailable — an order list is more useful than an error.
    let cards: OrderCardLookup | undefined;
    try {
      const catalogue = await this.getCachedCatalogue();
      cards = new Map(
        catalogue.map((card) => [
          card.id,
          { name: card.name, imageUrl: card.imageUrl },
        ]),
      );
    } catch (error) {
      this.logger.warn(
        `Perks orders could not enrich lines: ${(error as Error).message}`,
      );
    }

    return list.map((order) => mapOrder(order as Record<string, unknown>, cards));
  }

  // ------------------------------------------------------------------- wallet

  /**
   * Every wallet card the user owns, with local archive/hide state applied.
   * Hidden cards are already dropped. One upstream call — callers filter.
   */
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

    const mapped = entries.map((entry) => mapWalletCard(entry));
    const metadata = await this.walletMetadataModel
      .find({
        userId: objectId,
        cardKey: { $in: mapped.map((entry) => entry.cardKey) },
      })
      .lean();
    const byKey = new Map(metadata.map((entry) => [entry.cardKey, entry]));

    return mapped
      .map((entry) => {
        const local = byKey.get(entry.cardKey);
        return {
          ...entry,
          archived: local?.archived ?? false,
          archivedAt: local?.archivedAt ?? null,
          hidden: local?.hidden ?? false,
        };
      })
      .filter((entry) => !entry.hidden);
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
    // Single upstream fetch covers owned/gifted and active/archived alike.
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
    // Computed across EVERY order, not just the 5 shown, so the headline
    // figures mean "lifetime" rather than "recent".
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

  // --------------------------------------------------------------- calculator

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

  /**
   * Headline money figures for the dashboard, derived from real order data:
   * savings is face value minus what was actually paid; cashback is WeMAD's
   * own per-order field (present in their model, currently always 0.00).
   */
  private summariseSavings(
    orders: Awaited<ReturnType<PerksService['fetchOrders']>>,
  ) {
    let giftCardSavingsCents = 0;
    let cashbackBalanceCents = 0;

    for (const order of orders) {
      // Refunded orders never delivered value, so they must not inflate totals.
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

  // ------------------------------------------------------------------ helpers

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
      // The audit trail must never block the action it is describing.
      this.logger.warn(
        `Could not record perks event ${type}: ${(error as Error).message}`,
      );
    }
  }

  /** Empties the cart when a membership ends so nothing lingers on resume. */
  private async releaseCart(userId: Types.ObjectId) {
    await this.cartModel.updateOne(
      {
        userId,
        status: { $in: [PerksCartStatus.ACTIVE, PerksCartStatus.CHECKING_OUT] },
      },
      { $set: { items: [], status: PerksCartStatus.ACTIVE } },
    );
  }

  private discountTier() {
    return this.config.get<string>('PERKS_DISCOUNT_TIER', DEFAULT_DISCOUNT_TIER);
  }

  private catalogueTtl() {
    return this.positiveConfigNumber('PERKS_CATALOGUE_CACHE_TTL_SECONDS', 300);
  }

  private async getCachedCatalogue(): Promise<CatalogueCard[]> {
    const cacheKey = `perks:corp:catalogue:${CATALOGUE_CACHE_VERSION}`;
    // Bounded: a stalled cache must not stall the catalogue.
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
      this.api.listGiftCards({ paginate }),
    );
    // The tree lets a card tagged only with a leaf resolve to its real parent
    // group, so browse tiles match WeMAD's own taxonomy. Non-fatal: without it
    // such cards simply group under themselves.
    let parentIndex: ReturnType<typeof buildCategoryParentIndex> | undefined;
    try {
      parentIndex = buildCategoryParentIndex(await this.getCategories());
    } catch (error) {
      this.logger.warn(
        `Perks catalogue could not load categories: ${(error as Error).message}`,
      );
    }

    const tier = this.discountTier();
    const cards = raw
      .map((card) => mapCatalogueCard(card, tier, parentIndex))
      .filter((card) => Boolean(card.id && card.name));

    // A cache write failure must not fail a successful upstream response.
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
        throw new ConflictException('Could not create an active cart');
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
        this.assertCardValue(card, this.currency(item.faceValueCents));
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
        `Enter a valid amount for ${card.name}`,
      );
    }

    if (card.variablePrice) {
      const min = card.minAmount ?? 0;
      const max = card.maxAmount ?? Number.POSITIVE_INFINITY;
      if (value < min || value > max) {
        throw new UnprocessableEntityException(
          `${card.name} accepts between $${min} and $${max}`,
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
        `Value is not available for ${card.name}`,
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

  /**
   * Records created by the retired WeMAD product. Their wmadUserId belongs to a
   * different system and no corp account exists, so `active` there is a lie —
   * treat them as not registered so the user re-joins cleanly.
   * `credentialVersion` is the marker: it only exists on corp-era records.
   */
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
    };
  }

  private membershipResponse(membership: {
    wmadUserId?: string | null;
    status: PerksMembershipStatus;
    registeredAt?: Date | null;
    plan?: PerksMembershipPlan;
    cancelledAt?: Date | null;
    accessEndsAt?: Date | null;
  }) {
    return {
      wmadUserId: membership.wmadUserId ?? null,
      status: membership.status,
      registeredAt: membership.registeredAt ?? null,
      plan: membership.plan ?? PerksMembershipPlan.FREE,
      cancelledAt: membership.cancelledAt ?? null,
      accessEndsAt: membership.accessEndsAt ?? null,
    };
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
