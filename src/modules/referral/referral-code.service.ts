import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import {
  ReferralCode,
  ReferralCodeDocument,
  ReferralCodeStatus,
} from '../../database/schemas/referral-code.schema';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  User,
  UserDocument,
  UserRole,
} from '../../database/schemas/user.auth.schema';
import { TRIAL_DAYS } from '../subscription/subscription.constants';
import {
  DEFAULT_REFERRAL_LINK_BASE_URL,
  REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
} from './referral.constants';
import {
  codePrefixFromSlug,
  generateCodeCandidate,
  normalizeReferralCode,
} from './referral-math';

export interface ResolvedReferralCode {
  code: ReferralCodeDocument;
  chefUser: UserDocument;
  chefProfile: ChefProfileDocument | null;
}

const GENERATE_ATTEMPTS = 8;

function isDuplicateKey(error: any): boolean {
  return error?.code === 11000;
}

@Injectable()
export class ReferralCodeService {
  private readonly logger = new Logger(ReferralCodeService.name);

  constructor(
    @InjectModel(ReferralCode.name)
    private readonly codeModel: Model<ReferralCodeDocument>,
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  linkFor(code: string): string {
    const base = (
      this.config.get<string>('REFERRAL_LINK_BASE_URL') ||
      DEFAULT_REFERRAL_LINK_BASE_URL
    ).replace(/\/+$/, '');
    return `${base}/${code}`;
  }

  /** An active code whose owner is still a chef, or null. */
  async resolveActive(rawCode: unknown): Promise<ResolvedReferralCode | null> {
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized) return null;

    const code = await this.codeModel.findOne({
      code: normalized,
      status: ReferralCodeStatus.ACTIVE,
    });
    if (!code) return null;

    const chefUser = await this.userModel.findById(code.chefUserId);
    if (!chefUser || chefUser.role !== UserRole.CHEF) return null;

    const chefProfile = await this.chefProfileModel.findOne({
      userId: code.chefUserId,
    });
    return { code, chefUser, chefProfile };
  }

  /** Public preview for the landing page and the app's code field. */
  async publicLookup(rawCode: string) {
    const resolved = await this.resolveActive(rawCode);
    if (!resolved) return { valid: false };
    const { code, chefUser, chefProfile } = resolved;
    return {
      valid: true,
      code: code.code,
      link: this.linkFor(code.code),
      chef: {
        displayName: chefProfile?.displayName || chefUser.name,
        slug: chefProfile?.slug ?? null,
        avatarImageUrl: chefProfile?.avatarImageUrl ?? null,
      },
      discountPercent: REFERRAL_CUSTOMER_DISCOUNT_PERCENT,
      trialDays: TRIAL_DAYS,
    };
  }

  async listForChef(chefUserId: string | Types.ObjectId) {
    return this.codeModel
      .find({ chefUserId: new Types.ObjectId(String(chefUserId)) })
      .sort({ isPrimary: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Gives an approved or published chef their first code on demand. A chef
   * whose codes were all disabled by an admin is left alone.
   */
  async ensurePrimaryForChef(chefUserId: string) {
    const existing = await this.listForChef(chefUserId);
    if (existing.length > 0) return existing;

    const profile = await this.chefProfileModel.findOne({
      userId: new Types.ObjectId(chefUserId),
    });
    if (
      !profile ||
      !(profile.onboardingStatus === 'approved' || profile.isPublished)
    ) {
      return existing;
    }

    try {
      await this.createForChef(chefUserId, {}, null);
    } catch (error: any) {
      this.logger.warn(
        `Could not auto-create referral code for chef ${chefUserId}: ${error.message}`,
      );
    }
    return this.listForChef(chefUserId);
  }

  async createForChef(
    chefUserId: string,
    opts: { code?: string; makePrimary?: boolean },
    adminUserId: string | null,
  ) {
    if (!Types.ObjectId.isValid(chefUserId)) {
      throw new BadRequestException('Invalid chef id');
    }
    const chefObjectId = new Types.ObjectId(chefUserId);
    const chefUser = await this.userModel.findById(chefObjectId);
    if (!chefUser || chefUser.role !== UserRole.CHEF) {
      throw new NotFoundException('Chef not found');
    }
    const profile = await this.chefProfileModel.findOne({ userId: chefObjectId });
    const hasCodes = (await this.codeModel.countDocuments({ chefUserId: chefObjectId })) > 0;
    const isPrimary = opts.makePrimary === true || !hasCodes;

    const base = {
      chefUserId: chefObjectId,
      chefProfileId: profile?._id ?? null,
      isPrimary,
      status: ReferralCodeStatus.ACTIVE,
      createdBy: adminUserId ? new Types.ObjectId(adminUserId) : null,
    };

    let created: ReferralCodeDocument | null = null;
    if (opts.code) {
      const vanity = normalizeReferralCode(opts.code);
      if (!vanity) {
        throw new BadRequestException(
          'Codes are 4–16 letters or digits (spaces and hyphens are ignored)',
        );
      }
      try {
        created = await this.codeModel.create({ ...base, code: vanity });
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new BadRequestException(`Code ${vanity} is already taken`);
        }
        throw error;
      }
    } else {
      const prefix = codePrefixFromSlug(profile?.slug ?? chefUser.name);
      for (let attempt = 0; attempt < GENERATE_ATTEMPTS && !created; attempt++) {
        // Lengthen the suffix after a few collisions on a popular prefix.
        const suffixLength = attempt < 4 ? 3 : 4;
        const candidate = generateCodeCandidate(
          prefix,
          (max) => randomInt(max),
          suffixLength,
        );
        try {
          created = await this.codeModel.create({ ...base, code: candidate });
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
        }
      }
      if (!created) {
        throw new BadRequestException('Could not generate a unique code; try again');
      }
    }

    if (isPrimary) await this.demoteOtherCodes(chefObjectId, created._id as Types.ObjectId);
    return created.toObject();
  }

  async update(
    codeId: string,
    patch: { status?: ReferralCodeStatus; isPrimary?: boolean },
  ) {
    if (!Types.ObjectId.isValid(codeId)) {
      throw new BadRequestException('Invalid code id');
    }
    const code = await this.codeModel.findById(codeId);
    if (!code) throw new NotFoundException('Referral code not found');

    if (patch.status && patch.status !== code.status) {
      code.status = patch.status;
      code.disabledAt =
        patch.status === ReferralCodeStatus.DISABLED ? new Date() : null;
    }
    if (patch.isPrimary === true) code.isPrimary = true;
    await code.save();

    if (patch.isPrimary === true) {
      await this.demoteOtherCodes(code.chefUserId, code._id as Types.ObjectId);
    }
    return code.toObject();
  }

  async listAll(filter: { chefUserId?: string } = {}) {
    const query: Record<string, unknown> = {};
    if (filter.chefUserId && Types.ObjectId.isValid(filter.chefUserId)) {
      query.chefUserId = new Types.ObjectId(filter.chefUserId);
    }
    return this.codeModel.find(query).sort({ createdAt: -1 }).lean();
  }

  private async demoteOtherCodes(chefUserId: Types.ObjectId, keepId: Types.ObjectId) {
    await this.codeModel.updateMany(
      { chefUserId, _id: { $ne: keepId }, isPrimary: true },
      { $set: { isPrimary: false } },
    );
  }
}
