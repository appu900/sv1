import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import { ReferralCodeStatus } from '../../database/schemas/referral-code.schema';
import { TRIAL_DAYS } from '../subscription/subscription.constants';
import { ReferralCodeService } from './referral-code.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLedgerService } from './referral-ledger.service';
import { ReferralPayoutService } from './referral-payout.service';
import {
  REFERRAL_COMMISSION_RATE_BPS,
  REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
} from './referral.constants';
import { quarterKey } from './referral-math';

/** Aggregate-only views for the chef portal; never exposes subscriber details. */
@Injectable()
export class ReferralChefService {
  constructor(
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    private readonly codeService: ReferralCodeService,
    private readonly attributionService: ReferralAttributionService,
    private readonly ledgerService: ReferralLedgerService,
    private readonly payoutService: ReferralPayoutService,
  ) {}

  async summary(chefUserId: string) {
    const [codes, counts, balances, profile] = await Promise.all([
      this.codeService.ensurePrimaryForChef(chefUserId),
      this.attributionService.countsForChef(chefUserId),
      this.ledgerService.balancesForChef(chefUserId),
      this.chefProfileModel
        .findOne({ userId: new Types.ObjectId(chefUserId) })
        .select({ paymentDetails: 1, onboardingStatus: 1, isPublished: 1 })
        .lean(),
    ]);

    const activeCodes = codes.filter((c) => c.status === ReferralCodeStatus.ACTIVE);
    const primary = activeCodes.find((c) => c.isPrimary) ?? activeCodes[0] ?? null;

    return {
      primary: primary ? { code: primary.code, link: this.codeService.linkFor(primary.code) } : null,
      codes: activeCodes.map((c) => ({
        code: c.code,
        link: this.codeService.linkFor(c.code),
        isPrimary: c.isPrimary,
      })),
      eligible: Boolean(profile && (profile.onboardingStatus === 'approved' || profile.isPublished)),
      program: {
        commissionPercent: REFERRAL_COMMISSION_RATE_BPS / 100,
        discountPercent: REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
        trialDays: TRIAL_DAYS,
        payoutCadence: 'quarterly',
      },
      counts,
      balances,
      paymentDetailsStatus: profile?.paymentDetails?.status ?? 'not_collected',
      currentQuarter: quarterKey(new Date()),
    };
  }

  statements(chefUserId: string) {
    return this.payoutService.statementsForChef(chefUserId);
  }
}
