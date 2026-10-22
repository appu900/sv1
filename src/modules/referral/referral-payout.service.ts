import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ReferralPayout,
  ReferralPayoutDocument,
  ReferralPayoutStatus,
} from '../../database/schemas/referral-payout.schema';
import {
  ReferralLedgerEntry,
  ReferralLedgerEntryDocument,
  ReferralLedgerStatus,
} from '../../database/schemas/referral-ledger-entry.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { EmailQueueService } from '../../common/email';
import { formatMinor, quarterBounds } from './referral-math';

const PAYMENT_NOT_VERIFIED = 'payment_details_not_verified';

function isDuplicateKey(error: any): boolean {
  return error?.code === 11000;
}

/** Net commission per currency; positive overall (in USD when known) to be paid. */
export function isPayable(
  totals: Array<{ currency: string; commissionMinor: number }>,
  usdCents: number,
): boolean {
  if (!totals.some((t) => t.commissionMinor > 0)) return false;
  return usdCents > 0 || totals.every((t) => t.commissionMinor >= 0);
}

export function sumByCurrency(
  rows: Array<{ currency: string | null; commissionMinor: number | null }>,
): Array<{ currency: string; commissionMinor: number; entryCount: number }> {
  const totals = new Map<string, { commissionMinor: number; entryCount: number }>();
  for (const row of rows) {
    const currency = row.currency ?? 'UNKNOWN';
    const current = totals.get(currency) ?? { commissionMinor: 0, entryCount: 0 };
    current.commissionMinor += row.commissionMinor ?? 0;
    current.entryCount += 1;
    totals.set(currency, current);
  }
  return [...totals.entries()].map(([currency, value]) => ({ currency, ...value }));
}

@Injectable()
export class ReferralPayoutService {
  private readonly logger = new Logger(ReferralPayoutService.name);

  constructor(
    @InjectModel(ReferralPayout.name)
    private readonly payoutModel: Model<ReferralPayoutDocument>,
    @InjectModel(ReferralLedgerEntry.name)
    private readonly entryModel: Model<ReferralLedgerEntryDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Drafts one payout per chef from every PRODUCTION pending entry dated before
   * the quarter ends (older carried-forward balances included). Chefs whose
   * net balance is not positive carry it forward.
   */
  async generate(quarter: string, adminUserId: string) {
    const bounds = quarterBounds(quarter);
    if (!bounds) throw new BadRequestException('quarter must look like 2026-Q4');
    if (bounds.end > new Date()) {
      throw new BadRequestException(`${quarter} has not ended yet`);
    }

    const groups = await this.entryModel.aggregate<{
      _id: Types.ObjectId;
      ids: Types.ObjectId[];
      usdCents: number;
      rows: Array<{ currency: string | null; commissionMinor: number | null }>;
    }>([
      {
        $match: {
          environment: 'PRODUCTION',
          status: ReferralLedgerStatus.PENDING,
          payoutId: null,
          commissionMinor: { $ne: null },
          eventAt: { $lt: bounds.end },
        },
      },
      {
        $group: {
          _id: '$chefUserId',
          ids: { $push: '$_id' },
          usdCents: { $sum: { $ifNull: ['$commissionUsdCents', 0] } },
          rows: { $push: { currency: '$currency', commissionMinor: '$commissionMinor' } },
        },
      },
    ]);

    const result = {
      quarter,
      created: [] as string[],
      alreadyGenerated: [] as string[],
      carriedForward: [] as string[],
    };

    for (const group of groups) {
      const chefUserId = group._id.toString();
      if (!isPayable(sumByCurrency(group.rows), group.usdCents)) {
        result.carriedForward.push(chefUserId);
        continue;
      }

      const [profile, user] = await Promise.all([
        this.chefProfileModel.findOne({ userId: group._id }).lean(),
        this.userModel.findById(group._id).select({ name: 1 }).lean(),
      ]);
      const verified = profile?.paymentDetails?.status === 'verified';

      let payout: ReferralPayoutDocument;
      try {
        payout = await this.payoutModel.create({
          chefUserId: group._id,
          chefProfileId: profile?._id ?? null,
          chefDisplayName: profile?.displayName || user?.name || '',
          quarter,
          activeKey: `${chefUserId}:${quarter}`,
          status: verified ? ReferralPayoutStatus.DRAFT : ReferralPayoutStatus.ON_HOLD,
          holdReason: verified ? null : PAYMENT_NOT_VERIFIED,
          generatedBy: new Types.ObjectId(adminUserId),
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        result.alreadyGenerated.push(chefUserId);
        continue;
      }

      await this.entryModel.updateMany(
        { _id: { $in: group.ids }, status: ReferralLedgerStatus.PENDING, payoutId: null },
        { $set: { status: ReferralLedgerStatus.IN_PAYOUT, payoutId: payout._id } },
      );
      await this.refreshTotals(payout._id as Types.ObjectId);
      result.created.push(String(payout._id));
    }
    return result;
  }

  /** Totals come from the entries actually attached, so a race cannot skew them. */
  private async refreshTotals(payoutId: Types.ObjectId) {
    const entries = await this.entryModel
      .find({ payoutId })
      .select({ currency: 1, commissionMinor: 1, commissionUsdCents: 1 })
      .lean();
    const totalsByCurrency = sumByCurrency(entries);
    await this.payoutModel.updateOne(
      { _id: payoutId },
      {
        $set: {
          totalsByCurrency,
          totalUsdCents: entries.reduce((sum, e) => sum + (e.commissionUsdCents ?? 0), 0),
          entryCount: entries.length,
        },
      },
    );
  }

  async approve(payoutId: string, adminUserId: string) {
    const payout = await this.load(payoutId);
    if (![ReferralPayoutStatus.DRAFT, ReferralPayoutStatus.ON_HOLD].includes(payout.status)) {
      throw new BadRequestException(`Cannot approve a ${payout.status} payout`);
    }
    const profile = await this.chefProfileModel.findOne({ userId: payout.chefUserId }).lean();
    if (profile?.paymentDetails?.status !== 'verified') {
      await this.payoutModel.updateOne(
        { _id: payout._id },
        { $set: { status: ReferralPayoutStatus.ON_HOLD, holdReason: PAYMENT_NOT_VERIFIED } },
      );
      throw new BadRequestException('Chef payment details are not verified yet');
    }
    await this.payoutModel.updateOne(
      { _id: payout._id, status: payout.status },
      {
        $set: {
          status: ReferralPayoutStatus.APPROVED,
          holdReason: null,
          approvedBy: new Types.ObjectId(adminUserId),
          approvedAt: new Date(),
        },
      },
    );
    return this.get(payoutId);
  }

  async markPaid(
    payoutId: string,
    input: {
      paidAmountMinor: number;
      paidCurrency: string;
      paymentReference: string;
      paidAt?: string;
      fxNote?: string;
    },
    adminUserId: string,
  ) {
    const payout = await this.load(payoutId);
    if (payout.status !== ReferralPayoutStatus.APPROVED) {
      throw new BadRequestException('Only approved payouts can be marked paid');
    }
    const paidCurrency = String(input.paidCurrency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(paidCurrency)) {
      throw new BadRequestException('paidCurrency must be ISO 4217');
    }
    if (!Number.isInteger(input.paidAmountMinor) || input.paidAmountMinor <= 0) {
      throw new BadRequestException('paidAmountMinor must be a positive integer');
    }
    if (!input.paymentReference?.trim()) {
      throw new BadRequestException('paymentReference is required');
    }
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('Invalid paidAt');

    const res = await this.payoutModel.updateOne(
      { _id: payout._id, status: ReferralPayoutStatus.APPROVED },
      {
        $set: {
          status: ReferralPayoutStatus.PAID,
          paidAmountMinor: input.paidAmountMinor,
          paidCurrency,
          paymentReference: input.paymentReference.trim(),
          fxNote: input.fxNote?.trim() ?? '',
          paidAt,
          paidBy: new Types.ObjectId(adminUserId),
        },
      },
    );
    if (res.modifiedCount === 0) throw new BadRequestException('Payout changed; reload and retry');

    await this.entryModel.updateMany(
      { payoutId: payout._id, status: ReferralLedgerStatus.IN_PAYOUT },
      { $set: { status: ReferralLedgerStatus.PAID } },
    );
    await this.sendStatement(payout._id as Types.ObjectId);
    return this.get(payoutId);
  }

  async void(payoutId: string, reason: string, adminUserId: string) {
    const payout = await this.load(payoutId);
    if (payout.status === ReferralPayoutStatus.PAID || payout.status === ReferralPayoutStatus.VOID) {
      throw new BadRequestException(`Cannot void a ${payout.status} payout`);
    }
    await this.payoutModel.updateOne(
      { _id: payout._id },
      {
        $set: {
          status: ReferralPayoutStatus.VOID,
          voidedBy: new Types.ObjectId(adminUserId),
          voidedAt: new Date(),
          voidReason: reason ?? '',
        },
        $unset: { activeKey: '' },
      },
    );
    await this.entryModel.updateMany(
      { payoutId: payout._id, status: ReferralLedgerStatus.IN_PAYOUT },
      { $set: { status: ReferralLedgerStatus.PENDING, payoutId: null } },
    );
    return this.get(payoutId);
  }

  /** Called when an admin verifies a chef's payment details. */
  async releaseHolds(chefUserId: Types.ObjectId) {
    await this.payoutModel.updateMany(
      { chefUserId, status: ReferralPayoutStatus.ON_HOLD },
      { $set: { status: ReferralPayoutStatus.DRAFT, holdReason: null } },
    );
  }

  async list(filter: { quarter?: string; status?: string; chefUserId?: string }) {
    const query: Record<string, unknown> = {};
    if (filter.quarter) query.quarter = filter.quarter;
    if (filter.status) query.status = filter.status;
    if (filter.chefUserId && Types.ObjectId.isValid(filter.chefUserId)) {
      query.chefUserId = new Types.ObjectId(filter.chefUserId);
    }
    return this.payoutModel.find(query).sort({ quarter: -1, chefDisplayName: 1 }).lean();
  }

  async get(payoutId: string) {
    const payout = await this.load(payoutId);
    const entries = await this.entryModel
      .find({ payoutId: payout._id })
      .sort({ eventAt: 1 })
      .lean();
    return { ...payout.toObject(), entries };
  }

  /** Flat rows for the finance spreadsheet. */
  async exportRows(quarter: string) {
    const payouts = await this.payoutModel
      .find({ quarter, status: { $ne: ReferralPayoutStatus.VOID } })
      .sort({ chefDisplayName: 1 })
      .lean();
    const profiles = await this.chefProfileModel
      .find({ userId: { $in: payouts.map((p) => p.chefUserId) } })
      .select({ userId: 1, contactEmail: 1, paymentDetails: 1 })
      .lean();
    const profileByUser = new Map(profiles.map((p) => [p.userId.toString(), p]));

    return payouts.flatMap((payout) => {
      const profile = profileByUser.get(payout.chefUserId.toString());
      const totals = payout.totalsByCurrency.length
        ? payout.totalsByCurrency
        : [{ currency: '', commissionMinor: 0, entryCount: 0 }];
      return totals.map((total) => ({
        payoutId: String(payout._id),
        quarter: payout.quarter,
        chef: payout.chefDisplayName,
        chefUserId: payout.chefUserId.toString(),
        contactEmail: profile?.contactEmail ?? '',
        paymentDetailsStatus: profile?.paymentDetails?.status ?? 'not_collected',
        accountNumberLast4: profile?.paymentDetails?.accountNumberLast4 ?? '',
        status: payout.status,
        currency: total.currency,
        commission: total.currency ? formatMinor(total.commissionMinor, total.currency) : '',
        commissionMinor: total.commissionMinor,
        entries: total.entryCount,
        totalUsd: (payout.totalUsdCents / 100).toFixed(2),
        paidAmount:
          payout.paidAmountMinor !== null && payout.paidCurrency
            ? formatMinor(payout.paidAmountMinor, payout.paidCurrency)
            : '',
        paymentReference: payout.paymentReference,
        paidAt: payout.paidAt ? payout.paidAt.toISOString().slice(0, 10) : '',
        fxNote: payout.fxNote,
      }));
    });
  }

  /** What the chef sees: no admin ids or internal notes. */
  async statementsForChef(chefUserId: string) {
    const payouts = await this.payoutModel
      .find({
        chefUserId: new Types.ObjectId(chefUserId),
        status: { $ne: ReferralPayoutStatus.VOID },
      })
      .sort({ quarter: -1 })
      .lean();
    return payouts.map((payout) => ({
      id: String(payout._id),
      quarter: payout.quarter,
      status: payout.status === ReferralPayoutStatus.PAID ? 'paid' : 'processing',
      totalsByCurrency: payout.totalsByCurrency,
      totalUsdCents: payout.totalUsdCents,
      paidAt: payout.paidAt,
      paidAmountMinor: payout.paidAmountMinor,
      paidCurrency: payout.paidCurrency,
      paymentReference: payout.status === ReferralPayoutStatus.PAID ? payout.paymentReference : '',
    }));
  }

  private async sendStatement(payoutId: Types.ObjectId) {
    try {
      const payout = await this.payoutModel.findById(payoutId).lean();
      if (!payout || payout.paidAmountMinor === null || !payout.paidCurrency) return;
      const [profile, user] = await Promise.all([
        this.chefProfileModel.findOne({ userId: payout.chefUserId }).lean(),
        this.userModel.findById(payout.chefUserId).select({ email: 1, name: 1 }).lean(),
      ]);
      const email = profile?.contactEmail || user?.email;
      if (!email) return;

      const portalBase = (
        this.config.get<string>('CHEF_PORTAL_URL') || 'https://admin.saveful.app'
      ).replace(/\/+$/, '');
      await this.emailQueue.queueChefReferralStatementEmail({
        email,
        chefName: profile?.preferredContactName || profile?.displayName || user?.name || 'there',
        quarter: payout.quarter,
        paidAmount: formatMinor(payout.paidAmountMinor, payout.paidCurrency),
        paidAt: (payout.paidAt ?? new Date()).toISOString().slice(0, 10),
        paymentReference: payout.paymentReference,
        lines: payout.totalsByCurrency.map((total) => ({
          label: `${total.entryCount} payment${total.entryCount === 1 ? '' : 's'} in ${total.currency}`,
          amount: formatMinor(total.commissionMinor, total.currency),
        })),
        portalUrl: `${portalBase}/chef/referrals`,
      });
      await this.payoutModel.updateOne(
        { _id: payoutId },
        { $set: { statementEmailedAt: new Date() } },
      );
    } catch (error: any) {
      this.logger.error(`Statement email failed for payout ${payoutId}: ${error.message}`);
    }
  }

  private async load(payoutId: string) {
    if (!Types.ObjectId.isValid(payoutId)) throw new BadRequestException('Invalid payout id');
    const payout = await this.payoutModel.findById(payoutId);
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }
}
