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
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
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
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import {
  CalculatePerksDto,
  CreatePerksOrderDto,
  PerksSpendFrequency,
} from './dto/perks.dto';
import {
  PerksApiClient,
  PerksApiError,
  WmadOrderResult,
} from './perks-api-client';

export const PERKS_CATEGORIES = [
  { key: 'groceries', name: 'Groceries', discountBps: 450 },
  { key: 'fuel', name: 'Fuel', discountBps: 200 },
  { key: 'beer-wine', name: 'Beer & Wine', discountBps: 500 },
  { key: 'bags-jewellery', name: 'Bags & Jewellery', discountBps: 500 },
  { key: 'books-magazines', name: 'Books & Magazines', discountBps: 500 },
  { key: 'clothes-fashion', name: 'Clothes & Fashion', discountBps: 500 },
  { key: 'department-stores', name: 'Department Stores', discountBps: 500 },
  {
    key: 'electronics-whitegoods',
    name: 'Electronics & Whitegoods',
    discountBps: 400,
  },
  { key: 'entertainment', name: 'Entertainment', discountBps: 500 },
  {
    key: 'fashion-accessories',
    name: 'Fashion Accessories',
    discountBps: 500,
  },
  { key: 'transport', name: 'Transport', discountBps: 200 },
  { key: 'travel', name: 'Travel', discountBps: 1000 },
  { key: 'officeworks', name: 'Officeworks', discountBps: 500 },
  { key: 'toys-games', name: 'Toys & Games', discountBps: 500 },
  { key: 'eats-drinks', name: 'Eats & Drinks', discountBps: 500 },
  { key: 'hardware', name: 'Hardware', discountBps: 500 },
] as const;

@Injectable()
export class PerksService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(PerksMembership.name)
    private readonly membershipModel: Model<PerksMembershipDocument>,
    @InjectModel(PerksOrder.name)
    private readonly orderModel: Model<PerksOrderDocument>,
    private readonly api: PerksApiClient,
  ) {}

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

    const user = await this.userModel.findById(objectId).lean();
    if (!user) {
      throw new NotFoundException('Saveful user not found');
    }
    const registration = this.mapRegistration(user);

    let membership = await this.membershipModel.findOneAndUpdate(
      {
        userId: objectId,
        status: {
          $in: [PerksMembershipStatus.FAILED],
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
          throw new ConflictException(
            'Perks registration is already in progress',
          );
        }
        throw error;
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
      this.throwUpstream(apiError, 'Could not register the Saveful user');
    }
  }

  async getEcards(userId: string) {
    await this.ensureMembership(userId);
    const cards = await this.callUpstream(() => this.api.getEcards());
    return cards.map((card) => ({
      id: this.stringValue(card.ecard_id),
      name: this.stringValue(card.ecard_name),
      discountPercent: this.numberValue(card.discount),
      imageFilename: this.safeImageFilename(card.ecard_image),
      imageUrl: this.cardImageUrl(card.ecard_image),
      priceType: this.stringValue(card.ecard_pricetype),
      availableValues: this.parseCardValues(card.ecard_price),
      balanceLink: this.nullableString(card.ecard_balancelink),
      description: this.nullableString(card.ecard_desc),
      terms: this.nullableString(card.ecard_term),
      deliveryFee: this.numberValue(card.delivery_fee),
    }));
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

  async createOrder(
    userId: string,
    idempotencyKey: string,
    dto: CreatePerksOrderDto,
  ) {
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

    const orderReference = this.createOrderReference(userId);
    let order: PerksOrderDocument;
    try {
      order = await this.orderModel.create({
        userId: objectId,
        idempotencyKey,
        requestHash,
        orderReference,
        status: PerksOrderStatus.STARTED,
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
      await order.save();
      return this.orderResponse(order.toObject());
    } catch (error) {
      const apiError = this.asApiError(error);
      order.status = apiError.ambiguous
        ? PerksOrderStatus.UNKNOWN
        : PerksOrderStatus.FAILED;
      order.lastErrorCode = apiError.code;
      order.lastErrorMessage = apiError.message;
      await order.save();
      this.throwUpstream(apiError, 'Could not place the gift-card order');
    }
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

  async getWallet(userId: string, gifted: boolean) {
    await this.ensureMembership(userId);
    const orders = await this.orderModel
      .find({ userId: this.toObjectId(userId) })
      .select({ wmadOrderNumber: 1, orderReference: 1 })
      .lean();
    const allowed = new Set(
      orders.flatMap((order) =>
        [order.wmadOrderNumber, order.orderReference].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
    const entries = await this.callUpstream(() =>
      gifted ? this.api.getGiftedWallet() : this.api.getWallet(),
    );
    return entries
      .filter((entry) => {
        const number = this.stringValue(entry.order_number);
        const reference = this.stringValue(entry.order_reference);
        return allowed.has(number) || allowed.has(reference);
      })
      .map((entry) => this.mapWalletEntry(entry, gifted));
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

  private mapRegistration(user: User) {
    const nameParts = user.name.trim().split(/\s+/).filter(Boolean);
    const postcode = (user.pincode ?? '').trim();
    const missingFields: string[] = [];
    if (nameParts.length < 2) {
      missingFields.push('name');
    }
    if (!/^\d{4,}$/.test(postcode)) {
      missingFields.push('pincode');
    }
    if (missingFields.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Complete your Saveful profile before using Perks',
        missingFields,
      });
    }
    return {
      firstname: nameParts[0],
      lastname: nameParts.slice(1).join(' '),
      email: user.email.toLowerCase(),
      postcode,
    };
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
    return {
      cardName: this.stringValue(entry.ecard_name),
      value: this.numberValue(entry.ecard_value),
      issuedAt: this.nullableString(entry.ecard_issuedate),
      expiresIn: this.nullableString(entry.ecard_expiry),
      orderReference: this.nullableString(entry.order_reference),
      orderNumber: this.nullableString(entry.order_number),
      orderStatus: this.mapOrderStatus(entry.order_status),
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

  private findCategory(value: string) {
    const normalized = value.trim().toLowerCase();
    const category = PERKS_CATEGORIES.find(
      (item) =>
        item.key === normalized || item.name.toLowerCase() === normalized,
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
  }) {
    return {
      orderReference: order.orderReference,
      orderNumber: order.wmadOrderNumber ?? null,
      status: order.status,
      cardUrl: order.cardUrl ?? null,
      receiptUrl: order.receiptUrl ?? null,
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
