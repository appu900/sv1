import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  ReferralCode,
  ReferralCodeDocument,
} from '../../database/schemas/referral-code.schema';
import {
  ReferralAttribution,
  ReferralAttributionDocument,
  ReferralAttributionStatus,
} from '../../database/schemas/referral-attribution.schema';
import {
  ReferralLedgerEntry,
  ReferralLedgerEntryDocument,
  ReferralLedgerStatus,
} from '../../database/schemas/referral-ledger-entry.schema';
import {
  User,
  UserDocument,
  UserRole,
} from '../../database/schemas/user.auth.schema';
import { ReferralCodeService } from './referral-code.service';
import { ReferralPayoutService } from './referral-payout.service';

const PAYMENT_STATUSES = ['not_collected', 'pending', 'verified'] as const;

type Money = { currency: string; commissionMinor: number; count: number };

@Injectable()
export class ReferralAdminService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(ReferralCode.name)
    private readonly codeModel: Model<ReferralCodeDocument>,
    @InjectModel(ReferralAttribution.name)
    private readonly attributionModel: Model<ReferralAttributionDocument>,
    @InjectModel(ReferralLedgerEntry.name)
    private readonly entryModel: Model<ReferralLedgerEntryDocument>,
    private readonly codeService: ReferralCodeService,
    private readonly payoutService: ReferralPayoutService,
  ) {}

  /** One row per chef: codes, funnel counts, balances and payout readiness. */
  async overview() {
    const chefs = await this.userModel
      .find({ role: UserRole.CHEF })
      .select({ name: 1, email: 1 })
      .lean();
    const chefIds = chefs.map((c) => c._id);

    const [profiles, codes, attributionRows, ledgerRows] = await Promise.all([
      this.chefProfileModel
        .find({ userId: { $in: chefIds } })
        .select({
          userId: 1,
          displayName: 1,
          slug: 1,
          isPublished: 1,
          onboardingStatus: 1,
          paymentDetails: 1,
        })
        .lean(),
      this.codeModel.find({ chefUserId: { $in: chefIds } }).sort({ createdAt: -1 }).lean(),
      this.attributionModel.aggregate<{
        _id: { chef: Types.ObjectId; status: string };
        count: number;
      }>([
        { $match: { chefUserId: { $in: chefIds } } },
        { $group: { _id: { chef: '$chefUserId', status: '$status' }, count: { $sum: 1 } } },
      ]),
      this.entryModel.aggregate<{
        _id: { chef: Types.ObjectId; status: string; currency: string | null };
        commissionMinor: number;
        count: number;
      }>([
        {
          $match: {
            chefUserId: { $in: chefIds },
            environment: 'PRODUCTION',
            status: {
              $in: [
                ReferralLedgerStatus.PENDING,
                ReferralLedgerStatus.HELD,
                ReferralLedgerStatus.IN_PAYOUT,
                ReferralLedgerStatus.PAID,
              ],
            },
          },
        },
        {
          $group: {
            _id: { chef: '$chefUserId', status: '$status', currency: '$currency' },
            commissionMinor: { $sum: { $ifNull: ['$commissionMinor', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const profileByChef = new Map(profiles.map((p) => [p.userId.toString(), p]));
    const codesByChef = new Map<string, typeof codes>();
    for (const code of codes) {
      const key = code.chefUserId.toString();
      codesByChef.set(key, [...(codesByChef.get(key) ?? []), code]);
    }
    const countsByChef = new Map<string, Record<string, number>>();
    for (const row of attributionRows) {
      const key = row._id.chef.toString();
      const counts = countsByChef.get(key) ?? {};
      counts[row._id.status] = row.count;
      countsByChef.set(key, counts);
    }
    const moneyByChef = new Map<string, Record<string, Money[]>>();
    for (const row of ledgerRows) {
      const key = row._id.chef.toString();
      const buckets = moneyByChef.get(key) ?? {};
      const list = buckets[row._id.status] ?? [];
      list.push({
        currency: row._id.currency ?? 'UNKNOWN',
        commissionMinor: row.commissionMinor,
        count: row.count,
      });
      buckets[row._id.status] = list;
      moneyByChef.set(key, buckets);
    }

    return chefs.map((chef) => {
      const key = chef._id.toString();
      const profile = profileByChef.get(key);
      const chefCodes = codesByChef.get(key) ?? [];
      const primary = chefCodes.find((c) => c.isPrimary) ?? chefCodes[0] ?? null;
      const counts = countsByChef.get(key) ?? {};
      const money = moneyByChef.get(key) ?? {};
      const statusCount = (status: ReferralAttributionStatus) => counts[status] ?? 0;
      return {
        chefUserId: key,
        name: chef.name,
        email: chef.email,
        displayName: profile?.displayName ?? chef.name,
        slug: profile?.slug ?? null,
        isPublished: profile?.isPublished ?? false,
        onboardingStatus: profile?.onboardingStatus ?? null,
        paymentDetails: {
          status: profile?.paymentDetails?.status ?? 'not_collected',
          accountNumberLast4: profile?.paymentDetails?.accountNumberLast4 ?? null,
          currency: profile?.paymentDetails?.currency ?? null,
          note: profile?.paymentDetails?.note ?? null,
        },
        primaryCode: primary
          ? {
              id: String(primary._id),
              code: primary.code,
              status: primary.status,
              link: this.codeService.linkFor(primary.code),
            }
          : null,
        codes: chefCodes.map((c) => ({
          id: String(c._id),
          code: c.code,
          status: c.status,
          isPrimary: c.isPrimary,
          link: this.codeService.linkFor(c.code),
        })),
        counts: {
          signups: Object.entries(counts)
            .filter(([status]) => status !== ReferralAttributionStatus.VOID)
            .reduce((sum, [, n]) => sum + n, 0),
          trialing: statusCount(ReferralAttributionStatus.TRIALING),
          paying: statusCount(ReferralAttributionStatus.PAYING),
          lapsed: statusCount(ReferralAttributionStatus.LAPSED),
        },
        balances: {
          pending: money[ReferralLedgerStatus.PENDING] ?? [],
          held: money[ReferralLedgerStatus.HELD] ?? [],
          inPayout: money[ReferralLedgerStatus.IN_PAYOUT] ?? [],
          paid: money[ReferralLedgerStatus.PAID] ?? [],
        },
      };
    });
  }

  /**
   * Payout details live with finance, outside Saveful; only status, the last
   * four digits and the payout currency are recorded here.
   */
  async updatePaymentDetails(
    chefUserId: string,
    input: { status: string; accountNumberLast4?: string | null; currency?: string | null; note?: string | null },
  ) {
    if (!Types.ObjectId.isValid(chefUserId)) throw new BadRequestException('Invalid chef id');
    if (!(PAYMENT_STATUSES as readonly string[]).includes(input.status)) {
      throw new BadRequestException(`status must be one of ${PAYMENT_STATUSES.join(', ')}`);
    }
    const last4 = input.accountNumberLast4?.trim() || null;
    if (last4 && !/^\d{4}$/.test(last4)) {
      throw new BadRequestException('accountNumberLast4 must be 4 digits');
    }
    const currency = input.currency?.trim().toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('currency must be ISO 4217');
    }

    const chefObjectId = new Types.ObjectId(chefUserId);
    const verified = input.status === 'verified';
    const res = await this.chefProfileModel.updateOne(
      { userId: chefObjectId },
      {
        $set: {
          'paymentDetails.status': input.status,
          'paymentDetails.accountNumberLast4': last4,
          'paymentDetails.currency': currency,
          'paymentDetails.note': input.note?.trim() || null,
          'paymentDetails.verifiedAt': verified ? new Date() : null,
        },
      },
    );
    if (res.matchedCount === 0) throw new NotFoundException('Chef profile not found');
    if (verified) await this.payoutService.releaseHolds(chefObjectId);

    const profile = await this.chefProfileModel
      .findOne({ userId: chefObjectId })
      .select({ paymentDetails: 1 })
      .lean();
    return profile?.paymentDetails ?? null;
  }
}
