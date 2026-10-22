import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RevenueCatEvent,
  RevenueCatEventDocument,
} from '../../database/schemas/revenuecat-event.schema';
import {
  ReferralLedgerEntry,
  ReferralLedgerEntryDocument,
  ReferralLedgerStatus,
  ReferralLedgerType,
} from '../../database/schemas/referral-ledger-entry.schema';
import { ReferralAttributionDocument } from '../../database/schemas/referral-attribution.schema';
import { ReferralAttributionService } from './referral-attribution.service';
import {
  REFERRAL_COMMISSION_RATE_BPS,
  REFERRAL_EVENT_MAX_ATTEMPTS,
} from './referral.constants';
import {
  classifyRevenueCatEvent,
  computeCommission,
  quarterBounds,
} from './referral-math';

export interface CurrencyTotals {
  byCurrency: Array<{ currency: string; commissionMinor: number; count: number }>;
  usdCents: number;
  count: number;
}

const UNPAID_STATUSES = [ReferralLedgerStatus.PENDING, ReferralLedgerStatus.HELD];
const SETTLING_STATUSES = [ReferralLedgerStatus.IN_PAYOUT, ReferralLedgerStatus.PAID];

function isDuplicateKey(error: any): boolean {
  return error?.code === 11000;
}

function msToDate(value: unknown): Date | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

function negate(value: number | null | undefined): number | null {
  return typeof value === 'number' ? -value : null;
}

function environmentOf(event: any): string {
  return String(event?.environment || 'PRODUCTION').toUpperCase();
}

function emptyTotals(): CurrencyTotals {
  return { byCurrency: [], usdCents: 0, count: 0 };
}

@Injectable()
export class ReferralLedgerService {
  private readonly logger = new Logger(ReferralLedgerService.name);

  constructor(
    @InjectModel(RevenueCatEvent.name)
    private readonly eventModel: Model<RevenueCatEventDocument>,
    @InjectModel(ReferralLedgerEntry.name)
    private readonly entryModel: Model<ReferralLedgerEntryDocument>,
    private readonly attributionService: ReferralAttributionService,
  ) {}

  // ---------------------------------------------------------------------------
  // RevenueCat event log
  // ---------------------------------------------------------------------------

  /** Stores the raw event once; a retried webhook returns the stored row. */
  async recordEvent(payload: any): Promise<RevenueCatEventDocument | null> {
    const event = payload?.event ?? payload;
    const eventId = event?.id;
    if (typeof eventId !== 'string' || !eventId) {
      this.logger.warn(`RC event without id (type=${event?.type}) — not logged`);
      return null;
    }
    try {
      return await this.eventModel.create({
        eventId,
        type: event?.type ?? null,
        appUserId: event?.app_user_id ?? null,
        originalAppUserId: event?.original_app_user_id ?? null,
        aliases: Array.isArray(event?.aliases) ? event.aliases.map(String) : [],
        transactionId: event?.transaction_id ?? null,
        originalTransactionId: event?.original_transaction_id ?? null,
        environment: event?.environment ?? null,
        eventAt: msToDate(event?.event_timestamp_ms),
        payload: event,
        receivedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return this.eventModel.findOne({ eventId });
    }
  }

  /** Applies a logged event to the ledger. Failures stay unprocessed for the cron. */
  async processEvent(doc: RevenueCatEventDocument): Promise<void> {
    if (doc.referralProcessedAt) return;
    try {
      await this.applyEvent(doc.payload, doc.eventId);
      await this.eventModel.updateOne(
        { _id: doc._id },
        { $set: { referralProcessedAt: new Date(), referralError: null }, $inc: { attempts: 1 } },
      );
    } catch (error: any) {
      this.logger.error(`Referral ledger failed for RC event ${doc.eventId}: ${error.message}`);
      await this.eventModel.updateOne(
        { _id: doc._id },
        { $set: { referralError: String(error.message ?? error) }, $inc: { attempts: 1 } },
      );
    }
  }

  /** Retries events the webhook could not apply. Skips very recent ones still in flight. */
  async processPending(limit = 200): Promise<number> {
    const docs = await this.eventModel
      .find({
        referralProcessedAt: null,
        attempts: { $lt: REFERRAL_EVENT_MAX_ATTEMPTS },
        receivedAt: { $lte: new Date(Date.now() - 60_000) },
      })
      .sort({ receivedAt: 1 })
      .limit(limit);
    for (const doc of docs) await this.processEvent(doc);
    return docs.length;
  }

  // ---------------------------------------------------------------------------
  // Event rules
  // ---------------------------------------------------------------------------

  async applyEvent(event: any, eventId: string): Promise<void> {
    const kind = classifyRevenueCatEvent(event);
    if (kind === 'ignore') return;

    const attribution = await this.attributionService.findForEvent(event);
    if (!attribution) return;

    const happenedAt =
      msToDate(event?.purchased_at_ms) ?? msToDate(event?.event_timestamp_ms) ?? new Date();
    const notifiedAt = msToDate(event?.event_timestamp_ms) ?? new Date();

    switch (kind) {
      case 'trial_start':
        await this.attributionService.recordTrialStart(attribution, event, happenedAt);
        return;
      case 'payment':
        await this.createEarning(attribution, event, eventId, happenedAt);
        await this.attributionService.recordPayment(attribution, event, happenedAt);
        return;
      case 'refund':
        await this.reverseForRefund(event, eventId, notifiedAt);
        return;
      case 'refund_reversed':
        await this.restoreAfterRefundReversed(event, eventId, notifiedAt);
        return;
      case 'lapse':
        await this.attributionService.recordLapse(attribution);
        return;
      case 'reactivate':
        await this.attributionService.recordReactivation(attribution);
        return;
    }
  }

  private async insertIgnoringDuplicate(doc: Partial<ReferralLedgerEntry>) {
    try {
      await this.entryModel.create(doc);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  private async createEarning(
    attribution: ReferralAttributionDocument,
    event: any,
    eventId: string,
    eventAt: Date,
  ) {
    const result = computeCommission({
      priceInPurchasedCurrency: event?.price_in_purchased_currency,
      currency: event?.currency,
      taxPercentage: event?.tax_percentage,
      commissionPercentage: event?.commission_percentage,
      priceUsd: event?.price,
      rateBps: attribution.commissionRateBps,
    });
    const transactionId: string | null = event?.transaction_id ?? null;
    const renewalNumber = Number(event?.renewal_number);

    await this.insertIgnoringDuplicate({
      type: ReferralLedgerType.EARNING,
      status: result.ok ? ReferralLedgerStatus.PENDING : ReferralLedgerStatus.HELD,
      dedupeKey: transactionId ? `earn:${transactionId}` : `earn:evt:${eventId}`,
      chefUserId: attribution.chefUserId,
      attributionId: attribution._id as Types.ObjectId,
      subscriberUserId: attribution.subscriberUserId,
      rcEventId: eventId,
      rcEventType: event?.type ?? null,
      transactionId,
      originalTransactionId: event?.original_transaction_id ?? null,
      store: event?.store ?? null,
      environment: environmentOf(event),
      productId: event?.product_id ?? null,
      periodType: event?.period_type ?? null,
      renewalNumber: Number.isFinite(renewalNumber) ? renewalNumber : null,
      offerCode: event?.offer_code ?? null,
      currency: result.currency,
      grossMinor: result.grossMinor,
      taxRate: result.taxRate,
      storeFeeRate: result.storeFeeRate,
      netMinor: result.ok ? result.netMinor : null,
      commissionRateBps: attribution.commissionRateBps,
      commissionMinor: result.ok ? result.commissionMinor : null,
      commissionUsdCents: result.ok ? result.commissionUsdCents : null,
      eventAt,
      holdReason: result.ok ? null : result.holdReason,
    });
  }

  private async findEarningForRefund(event: any) {
    const transactionId: string | undefined = event?.transaction_id;
    if (transactionId) {
      const byTransaction = await this.entryModel
        .findOne({ type: ReferralLedgerType.EARNING, transactionId })
        .sort({ createdAt: -1 });
      if (byTransaction) return byTransaction;
    }
    const originalTransactionId: string | undefined = event?.original_transaction_id;
    if (!originalTransactionId) return null;
    return this.entryModel
      .findOne({
        type: ReferralLedgerType.EARNING,
        originalTransactionId,
        status: { $ne: ReferralLedgerStatus.REVERSED },
      })
      .sort({ eventAt: -1 });
  }

  /**
   * Unpaid earning: it and its reversal are both marked reversed (net zero,
   * kept for audit). Earning already in a payout or paid: the reversal is a
   * pending negative entry that nets against the chef's next payout.
   */
  private async reverseForRefund(event: any, eventId: string, eventAt: Date) {
    let earning = await this.findEarningForRefund(event);
    if (!earning || earning.status === ReferralLedgerStatus.REVERSED) return;

    let reversalStatus = ReferralLedgerStatus.PENDING;
    if (UNPAID_STATUSES.includes(earning.status)) {
      const res = await this.entryModel.updateOne(
        { _id: earning._id, status: { $in: UNPAID_STATUSES } },
        { $set: { status: ReferralLedgerStatus.REVERSED } },
      );
      if (res.modifiedCount === 1) {
        reversalStatus = ReferralLedgerStatus.REVERSED;
      } else {
        // Picked up by a payout in the meantime.
        earning = await this.entryModel.findById(earning._id);
        if (!earning || !SETTLING_STATUSES.includes(earning.status)) return;
      }
    }

    await this.insertIgnoringDuplicate({
      type: ReferralLedgerType.REVERSAL,
      status: reversalStatus,
      dedupeKey: `rev:${earning._id}`,
      chefUserId: earning.chefUserId,
      attributionId: earning.attributionId,
      subscriberUserId: earning.subscriberUserId,
      rcEventId: eventId,
      rcEventType: event?.type ?? null,
      transactionId: earning.transactionId,
      originalTransactionId: earning.originalTransactionId,
      store: earning.store,
      environment: earning.environment,
      productId: earning.productId,
      periodType: earning.periodType,
      renewalNumber: earning.renewalNumber,
      offerCode: earning.offerCode,
      currency: earning.currency,
      grossMinor: negate(earning.grossMinor),
      taxRate: earning.taxRate,
      storeFeeRate: earning.storeFeeRate,
      netMinor: negate(earning.netMinor),
      commissionRateBps: earning.commissionRateBps,
      commissionMinor: negate(earning.commissionMinor),
      commissionUsdCents: negate(earning.commissionUsdCents),
      eventAt,
      reversesEntryId: earning._id as Types.ObjectId,
    });
  }

  /** App Store reversed a refund: the commission is earned again as a fresh entry. */
  private async restoreAfterRefundReversed(event: any, eventId: string, eventAt: Date) {
    const transactionId: string | undefined = event?.transaction_id;
    const originalTransactionId: string | undefined = event?.original_transaction_id;
    const match = transactionId
      ? { transactionId }
      : originalTransactionId
        ? { originalTransactionId }
        : null;
    if (!match) return;

    const reversal = await this.entryModel
      .findOne({ type: ReferralLedgerType.REVERSAL, ...match })
      .sort({ createdAt: -1 });
    if (!reversal?.reversesEntryId) return;
    const original = await this.entryModel.findById(reversal.reversesEntryId).lean();
    if (!original) return;

    const {
      _id,
      __v,
      createdAt,
      updatedAt,
      dedupeKey,
      rcEventId,
      payoutId,
      resolvedBy,
      resolvedAt,
      ...amounts
    } = original as any;
    await this.insertIgnoringDuplicate({
      ...amounts,
      type: ReferralLedgerType.EARNING,
      status:
        original.commissionMinor === null
          ? ReferralLedgerStatus.HELD
          : ReferralLedgerStatus.PENDING,
      dedupeKey: `earn:${original.transactionId ?? original._id}:rr:${eventId}`,
      rcEventId: eventId,
      rcEventType: event?.type ?? null,
      eventAt,
      payoutId: null,
      note: 'Refund reversed by the store',
    });
  }

  // ---------------------------------------------------------------------------
  // Balances
  // ---------------------------------------------------------------------------

  /** PRODUCTION balances for one chef, per status and currency. */
  async balancesForChef(chefUserId: string) {
    const rows = await this.entryModel.aggregate<{
      _id: { status: ReferralLedgerStatus; currency: string | null };
      commissionMinor: number;
      usdCents: number;
      count: number;
    }>([
      {
        $match: {
          chefUserId: new Types.ObjectId(chefUserId),
          environment: 'PRODUCTION',
          status: { $ne: ReferralLedgerStatus.REVERSED },
        },
      },
      {
        $group: {
          _id: { status: '$status', currency: '$currency' },
          commissionMinor: { $sum: { $ifNull: ['$commissionMinor', 0] } },
          usdCents: { $sum: { $ifNull: ['$commissionUsdCents', 0] } },
          count: { $sum: 1 },
        },
      },
    ]);

    const buckets: Record<'pending' | 'held' | 'inPayout' | 'paid' | 'lifetime', CurrencyTotals> = {
      pending: emptyTotals(),
      held: emptyTotals(),
      inPayout: emptyTotals(),
      paid: emptyTotals(),
      lifetime: emptyTotals(),
    };
    const bucketFor: Record<string, keyof typeof buckets> = {
      [ReferralLedgerStatus.PENDING]: 'pending',
      [ReferralLedgerStatus.HELD]: 'held',
      [ReferralLedgerStatus.IN_PAYOUT]: 'inPayout',
      [ReferralLedgerStatus.PAID]: 'paid',
    };
    const add = (totals: CurrencyTotals, row: (typeof rows)[number]) => {
      const currency = row._id.currency ?? 'UNKNOWN';
      const existing = totals.byCurrency.find((item) => item.currency === currency);
      if (existing) {
        existing.commissionMinor += row.commissionMinor;
        existing.count += row.count;
      } else {
        totals.byCurrency.push({ currency, commissionMinor: row.commissionMinor, count: row.count });
      }
      totals.usdCents += row.usdCents;
      totals.count += row.count;
    };

    for (const row of rows) {
      const bucket = bucketFor[row._id.status];
      if (!bucket) continue;
      add(buckets[bucket], row);
      // Held earnings have no confirmed amount yet, so they stay out of lifetime.
      if (bucket !== 'held') add(buckets.lifetime, row);
    }
    return buckets;
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async listForAdmin(filter: {
    chefUserId?: string;
    status?: string;
    type?: string;
    environment?: string;
    quarter?: string;
    page?: number;
    limit?: number;
  }) {
    const query: Record<string, any> = {};
    if (filter.chefUserId && Types.ObjectId.isValid(filter.chefUserId)) {
      query.chefUserId = new Types.ObjectId(filter.chefUserId);
    }
    if (filter.status) query.status = filter.status;
    if (filter.type) query.type = filter.type;
    query.environment = (filter.environment || 'PRODUCTION').toUpperCase();
    if (filter.quarter) {
      const bounds = quarterBounds(filter.quarter);
      if (!bounds) throw new BadRequestException('quarter must look like 2026-Q4');
      query.eventAt = { $gte: bounds.start, $lt: bounds.end };
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const page = Math.max(filter.page ?? 1, 1);

    const [items, total] = await Promise.all([
      this.entryModel
        .find(query)
        .sort({ eventAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.entryModel.countDocuments(query),
    ]);
    return { items, total, page, limit };
  }

  /** Finance confirmed the amount of a held earning from store reports. */
  async resolveHold(
    entryId: string,
    input: { currency: string; commissionMinor: number; netMinor?: number; note?: string },
    adminUserId: string,
  ) {
    const entry = await this.loadHeld(entryId);
    const currency = String(input.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('currency must be ISO 4217');
    if (!Number.isInteger(input.commissionMinor) || input.commissionMinor < 0) {
      throw new BadRequestException('commissionMinor must be a non-negative integer');
    }
    const res = await this.entryModel.updateOne(
      { _id: entry._id, status: ReferralLedgerStatus.HELD },
      {
        $set: {
          status: ReferralLedgerStatus.PENDING,
          currency,
          commissionMinor: input.commissionMinor,
          netMinor: Number.isInteger(input.netMinor) ? input.netMinor : entry.netMinor,
          note: input.note ?? '',
          resolvedBy: new Types.ObjectId(adminUserId),
          resolvedAt: new Date(),
        },
      },
    );
    if (res.modifiedCount === 0) throw new BadRequestException('Entry is no longer held');
    return this.entryModel.findById(entry._id).lean();
  }

  async voidHold(entryId: string, note: string, adminUserId: string) {
    const entry = await this.loadHeld(entryId);
    await this.entryModel.updateOne(
      { _id: entry._id, status: ReferralLedgerStatus.HELD },
      {
        $set: {
          status: ReferralLedgerStatus.REVERSED,
          note: note ?? '',
          resolvedBy: new Types.ObjectId(adminUserId),
          resolvedAt: new Date(),
        },
      },
    );
    return this.entryModel.findById(entry._id).lean();
  }

  /** Manual correction (positive or negative) that settles with the next payout. */
  async createAdjustment(
    input: {
      chefUserId: string;
      currency: string;
      commissionMinor: number;
      commissionUsdCents?: number;
      note: string;
    },
    adminUserId: string,
  ) {
    if (!Types.ObjectId.isValid(input.chefUserId)) throw new BadRequestException('Invalid chef id');
    const currency = String(input.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('currency must be ISO 4217');
    if (!Number.isInteger(input.commissionMinor) || input.commissionMinor === 0) {
      throw new BadRequestException('commissionMinor must be a non-zero integer');
    }
    if (!input.note?.trim()) throw new BadRequestException('A note is required');

    const created = await this.entryModel.create({
      type: ReferralLedgerType.ADJUSTMENT,
      status: ReferralLedgerStatus.PENDING,
      chefUserId: new Types.ObjectId(input.chefUserId),
      environment: 'PRODUCTION',
      currency,
      commissionRateBps: REFERRAL_COMMISSION_RATE_BPS,
      commissionMinor: input.commissionMinor,
      commissionUsdCents: Number.isInteger(input.commissionUsdCents)
        ? input.commissionUsdCents
        : null,
      eventAt: new Date(),
      note: input.note.trim(),
      createdBy: new Types.ObjectId(adminUserId),
    });
    return created.toObject();
  }

  private async loadHeld(entryId: string) {
    if (!Types.ObjectId.isValid(entryId)) throw new BadRequestException('Invalid entry id');
    const entry = await this.entryModel.findById(entryId);
    if (!entry) throw new NotFoundException('Ledger entry not found');
    if (entry.status !== ReferralLedgerStatus.HELD) {
      throw new BadRequestException('Only held entries can be resolved');
    }
    return entry;
  }
}
