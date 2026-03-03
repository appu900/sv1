import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  QantasFFN,
  QantasFFNDocument,
  QantasLinkStatus,
} from 'src/database/schemas/qantas-ffn.schema';
import {
  QantasPointsAllocation,
  QantasPointsAllocationDocument,
  QantasAllocationStatus,
} from 'src/database/schemas/qantas-points-allocation.schema';
import { TrackSurvey, TrackSurveyDocument } from 'src/database/schemas/track-survey.schema';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';
import { LinkFFNDto } from './dto/link-ffn.dto';
import { QantasFFNResponseDto, QantasDashboardDto } from './dto/qantas-response.dto';
import {
  QantasApiClient,
  QantasAlreadyLinkedError,
  QantasDuplicateAccrualError,
  QantasRetryableError,
  QantasApiError,
  QantasAkamaiBlockError,
} from './qantas-api-client';

@Injectable()
export class QantasService {
  private readonly logger = new Logger(QantasService.name);

  private readonly minSurveyThreshold: number;
  private readonly pointsPerChallenge: number;
  private readonly isEnabled: boolean;

  constructor(
    @InjectModel(QantasFFN.name)
    private readonly qantasFFNModel: Model<QantasFFNDocument>,
    @InjectModel(QantasPointsAllocation.name)
    private readonly allocationModel: Model<QantasPointsAllocationDocument>,
    @InjectModel(TrackSurvey.name)
    private readonly trackSurveyModel: Model<TrackSurveyDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
    private readonly qantasApiClient: QantasApiClient,
  ) {
    this.minSurveyThreshold = this.configService.get<number>(
      'QANTAS_MIN_SURVEY_THRESHOLD',
      4,
    );
    this.pointsPerChallenge = this.configService.get<number>(
      'QANTAS_POINTS_FOR_SURVEY_CHALLENGE',
      100,
    );
    this.isEnabled =
      this.configService.get<string>('QANTAS_FREQ_FLYER_ENABLED', 'false') === 'true';
  }

 
  async linkFFN(userId: string, dto: LinkFFNDto): Promise<QantasFFNResponseDto> {
    if (!this.isEnabled) {
      throw new BadRequestException(
        'Qantas Frequent Flyer integration is currently disabled.',
      );
    }

    const userIdObj = new Types.ObjectId(userId);
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new BadRequestException('User not found');

    const activeProfile = await this.qantasFFNModel
      .findOne({ userId: userIdObj, isLinked: true, isDeleted: false })
      .lean();

    if (activeProfile) {
      throw new ConflictException(
        'A Qantas Frequent Flyer account is already linked. Please unlink first.',
      );
    }

    const previousDifferent = await this.qantasFFNModel
      .findOne({
        userId: userIdObj,
        memberId: { $ne: dto.memberId },
        linkStatus: { $in: [QantasLinkStatus.ACTIVE, QantasLinkStatus.UNLINKED] },
      })
      .lean();

    if (previousDifferent) {
      throw new ConflictException(
        'You were previously linked with a different FFN. Please contact support.',
      );
    }

    const ffnInUse = await this.qantasFFNModel
      .findOne({
        memberId: dto.memberId,
        userId: { $ne: userIdObj },
        isDeleted: false,
        isLinked: true,
      })
      .lean();

    if (ffnInUse) {
      throw new ConflictException(
        'This Frequent Flyer number is already linked to another account.',
      );
    }

    let existingProfile = await this.qantasFFNModel.findOne({
      userId: userIdObj,
      memberId: dto.memberId,
      linkStatus: QantasLinkStatus.UNLINKED,
    });

    let linkResponse: any;
    try {
      linkResponse = await this.qantasApiClient.linkMember({
        memberId: dto.memberId,
        surname: dto.surname,
        partnerReferenceId: userId, 
      });
    } catch (error) {
     
      if (error instanceof QantasAlreadyLinkedError) {
        this.logger.warn(
          `FFN ${dto.memberId} already linked on Qantas side (409)`,
        );

        linkResponse = { alreadyLinked: true };
      } else if (error instanceof QantasAkamaiBlockError) {
        this.logger.error('Qantas API blocked by Akamai — IP not whitelisted');
        throw new BadRequestException(
          'Qantas API is not reachable from this server (blocked by CDN). ' +
            'The server IP may need to be whitelisted with Qantas.',
        );
      } else if (error instanceof QantasApiError) {
        this.logger.error(
          `Qantas linking API failed [${error.statusCode}]: ${error.responseBody.substring(0, 500)}`,
        );

        if (error.statusCode === 401) {
          throw new BadRequestException(
            'Qantas API credentials are invalid. Please contact support.',
          );
        }

        if (error.statusCode === 404) {
          throw new BadRequestException(
            'The Qantas Frequent Flyer number could not be verified. ' +
              'Please check your FFN and surname.',
          );
        }

        throw new BadRequestException(
          `Qantas API returned an error (${error.statusCode}). Please try again later.`,
        );
      } else {
        this.logger.error('Qantas Partner Linking API call failed', error);
        throw new BadRequestException(
          'Unable to verify your Qantas Frequent Flyer details. Please try again later.',
        );
      }
    }

    if (existingProfile) {
      existingProfile.isLinked = true;
      existingProfile.linkStatus = QantasLinkStatus.ACTIVE;
      existingProfile.linkResponse = linkResponse;
      existingProfile.linkedAt = new Date();
      existingProfile.isDeleted = false;
      existingProfile.surname = dto.surname.toUpperCase();
      existingProfile.surveysCompletedSinceLink = 0;
      const saved = await existingProfile.save();
      return this.toResponseDto(saved);
    }

    const ffnDoc = new this.qantasFFNModel({
      userId: userIdObj,
      memberId: dto.memberId,
      surname: dto.surname.toUpperCase(),
      isLinked: true,
      linkStatus: QantasLinkStatus.ACTIVE,
      linkResponse: linkResponse,
      linkedAt: new Date(),
      isRewarded: false,
      isDeleted: false,
      surveysCompletedSinceLink: 0,
      totalPointsAwarded: 0,
      greenTierUnlocked: false,
    });

    const saved = await ffnDoc.save();
    return this.toResponseDto(saved);
  }


  async unlinkFFN(
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const userIdObj = new Types.ObjectId(userId);

    const profile = await this.qantasFFNModel.findOne({
      userId: userIdObj,
      isLinked: true,
      isDeleted: false,
    });

    if (!profile) {
      throw new NotFoundException('No linked Qantas account found.');
    }

    try {
      await this.qantasApiClient.unlinkMember({
        memberId: profile.memberId,
        surname: profile.surname,
        partnerReferenceId: userId,
      });
    } catch (error) {
      this.logger.error(
        `Qantas unlink API failed for member ${profile.memberId}: ${error}`,
      );
    }

    profile.isLinked = false;
    profile.linkStatus = QantasLinkStatus.UNLINKED;
    profile.isDeleted = true;
    await profile.save();

    return {
      success: true,
      message: 'Qantas Frequent Flyer account unlinked successfully.',
    };
  }


  async getFFN(userId: string): Promise<QantasFFNResponseDto | null> {
    const userIdObj = new Types.ObjectId(userId);
    const ffn = await this.qantasFFNModel
      .findOne({ userId: userIdObj, isDeleted: false, isLinked: true })
      .lean();
    if (!ffn) return null;
    return this.toResponseDto(ffn);
  }

  async getDashboard(userId: string): Promise<QantasDashboardDto | null> {
    const ffn = await this.getFFN(userId);
    if (!ffn) return null;

    const profileId = new Types.ObjectId(ffn._id);

    const surveysCount = await this.getSurveyCountSinceLinking(
      userId,
      ffn.linkedAt,
    );

    const allocations = await this.allocationModel
      .find({ userQantasProfileId: profileId, isDeleted: false })
      .sort({ createdAt: -1 })
      .lean();

    const pointsHistory = allocations
      .filter((a) => a.status === QantasAllocationStatus.ACCEPTED)
      .map((a) => ({
        points: this.pointsPerChallenge,
        reason: a.reason,
        awardedAt:
          a.processedAt?.toISOString() ?? (a as any).createdAt?.toISOString(),
        accrualReferenceNumber: a.accrualReferenceNumber ?? null,
      }));

    const progress = Math.min(surveysCount / this.minSurveyThreshold, 1);

    return {
      ffn,
      surveysInCycle: surveysCount,
      surveysRequired: this.minSurveyThreshold,
      pointsPerCycle: this.pointsPerChallenge,
      greenTierUnlocked: ffn.greenTierUnlocked,
      totalPointsAwarded: ffn.totalPointsAwarded,
      isRewarded: ffn.isRewarded,
      progress,
      pointsHistory,
      pendingAllocation: allocations.some(
        (a) => a.status === QantasAllocationStatus.PENDING,
      ),
    };
  }


  async onSurveyCompleted(userId: string, _surveyId: string): Promise<void> {
    if (!this.isEnabled) return;

    const userIdObj = new Types.ObjectId(userId);

    const profile = await this.qantasFFNModel.findOne({
      userId: userIdObj,
      isLinked: true,
      isDeleted: false,
      isRewarded: false,
    });

    if (!profile) return;

    profile.surveysCompletedSinceLink += 1;
    await profile.save();

    const surveysCount = await this.getSurveyCountSinceLinking(
      userId,
      profile.linkedAt?.toISOString() ?? new Date().toISOString(),
    );

    if (surveysCount < this.minSurveyThreshold) return;

    const existingAllocation = await this.allocationModel.findOne({
      userQantasProfileId: profile._id,
      isDeleted: false,
      status: {
        $in: [QantasAllocationStatus.PENDING, QantasAllocationStatus.ACCEPTED],
      },
    });

    if (existingAllocation) {
      this.logger.log(
        `Allocation already exists for profile ${profile._id} (status: ${existingAllocation.status})`,
      );
      return;
    }

    const qualifyingSurveys = await this.trackSurveyModel
      .find({
        userId: userIdObj,
        completedAt: { $gte: profile.linkedAt ?? new Date(0) },
      })
      .sort({ completedAt: 1 })
      .limit(this.minSurveyThreshold)
      .lean();

    const allocation = new this.allocationModel({
      userQantasProfileId: profile._id,
      reason: 'challenge_complete',
      referenceIds: qualifyingSurveys.map((s) => s._id.toString()),
      status: QantasAllocationStatus.PENDING,
    });

    await allocation.save();

    this.logger.log(
      `Created pending Qantas points allocation ${allocation._id} for user ${userId}`,
    );
  }

  async processPendingAllocations(): Promise<void> {
    if (!this.isEnabled) return;

    const pendingAllocations = await this.allocationModel.find({
      status: QantasAllocationStatus.PENDING,
      isDeleted: false,
    });

    this.logger.log(
      `Found ${pendingAllocations.length} pending Qantas allocations to process`,
    );

    for (const allocation of pendingAllocations) {
      await this.claimAllocation(allocation);
    }
  }


  private async claimAllocation(
    allocation: QantasPointsAllocationDocument,
  ): Promise<void> {
    if (allocation.status !== QantasAllocationStatus.PENDING) return;

    const profile = await this.qantasFFNModel.findById(
      allocation.userQantasProfileId,
    );

    if (!profile || profile.isRewarded || profile.isDeleted || !profile.isLinked) {
      allocation.status = QantasAllocationStatus.USER_ALREADY_CLAIMED;
      allocation.processedAt = new Date();
      await allocation.save();
      return;
    }

    try {
      const earnResult = await this.qantasApiClient.earnPoints({
        memberId: profile.memberId,
        points: this.pointsPerChallenge,
        clientRef: allocation._id.toString(), 
      });

      allocation.status = QantasAllocationStatus.ACCEPTED;
      allocation.processedAt = new Date();
      allocation.accrualReferenceNumber = earnResult.transactionNumber;
      allocation.qantasResponse = earnResult;
      await allocation.save();

      profile.isRewarded = true;
      profile.greenTierUnlocked = true;
      profile.totalPointsAwarded += this.pointsPerChallenge;
      await profile.save();

      this.logger.log(
        `Awarded ${earnResult.pointsEarned} Qantas points to member ${profile.memberId} ` +
          `(allocation ${allocation._id}, txn ${earnResult.transactionNumber})`,
      );

      await this.fetchAndStoreExpiration(profile);
    } catch (error) {
      if (error instanceof QantasDuplicateAccrualError) {
        allocation.status = QantasAllocationStatus.ACCEPTED;
        allocation.processedAt = new Date();
        allocation.qantasResponse = {
          note: 'Duplicate accrual (ACCRUAL_ALREADY_EXISTS)',
          error: error.responseBody,
        };
        await allocation.save();

        if (!profile.isRewarded) {
          profile.isRewarded = true;
          profile.greenTierUnlocked = true;
          profile.totalPointsAwarded += this.pointsPerChallenge;
          await profile.save();
        }

        this.logger.warn(
          `Qantas allocation ${allocation._id} was already processed (duplicate)`,
        );
        return;
      }

      if (error instanceof QantasRetryableError) {
        allocation.retryCount = (allocation.retryCount ?? 0) + 1;
        if (allocation.retryCount >= 3) {
          allocation.status = QantasAllocationStatus.FAILED;
          allocation.processedAt = new Date();
          allocation.qantasResponse = {
            error: `Final failure after ${allocation.retryCount} attempts: ${error.message}`,
          };
          await allocation.save();
          this.logger.error(
            `Qantas allocation ${allocation._id} FAILED after ${allocation.retryCount} attempts`,
          );
          return;
        }
        await allocation.save();
        this.logger.warn(
          `Retryable error on allocation ${allocation._id} (attempt ${allocation.retryCount}/3): ${error.message}`,
        );
        return;
      }

      allocation.status = QantasAllocationStatus.REJECTED;
      allocation.processedAt = new Date();
      allocation.qantasResponse = {
        error:
          error instanceof QantasApiError ? error.responseBody : String(error),
      };
      await allocation.save();

      this.logger.error(
        `Failed to claim Qantas points for allocation ${allocation._id}`,
        error,
      );
    }
  }


  private async fetchAndStoreExpiration(
    profile: QantasFFNDocument,
  ): Promise<void> {
    if (
      profile.expirationDate &&
      new Date(profile.expirationDate) > new Date()
    ) {
      this.logger.log(
        `Skipping expiration fetch for ${profile.memberId} — expires ${profile.expirationDate}`,
      );
      return;
    }

    try {
      const detail = await this.qantasApiClient.getMemberDetail(
        profile.memberId,
      );

      profile.expirationDate = detail.ffExpireDate
        ? new Date(detail.ffExpireDate)
        : null;
      profile.loyaltyApiContactedAt = new Date();
      await profile.save();

      this.logger.log(
        `Updated expiration for ${profile.memberId}: ${detail.ffExpireDate}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch expiration for member ${profile.memberId}`,
        error,
      );
    }
  }

  async resetRewardsForExpiredMemberships(): Promise<void> {
    const now = new Date();

    const expiredProfiles = await this.qantasFFNModel.find({
      isRewarded: true,
      isDeleted: false,
      isLinked: true,
      expirationDate: { $ne: null, $lte: now },
    });

    for (const profile of expiredProfiles) {
      profile.isRewarded = false;
      profile.surveysCompletedSinceLink = 0;
      await profile.save();

      await this.fetchAndStoreExpiration(profile);

      this.logger.log(
        `Reset rewards for member ${profile.memberId} — new membership year`,
      );
    }

    this.logger.log(
      `Reset rewards for ${expiredProfiles.length} expired memberships`,
    );
  }


  private async getSurveyCountSinceLinking(
    userId: string,
    linkedAt: string | null,
  ): Promise<number> {
    const userIdObj = new Types.ObjectId(userId);

    return this.trackSurveyModel.countDocuments({
      userId: userIdObj,
      completedAt: { $gte: linkedAt ? new Date(linkedAt) : new Date(0) },
    });
  }

  private toResponseDto(doc: any): QantasFFNResponseDto {
    return {
      _id: doc._id.toString(),
      userId: doc.userId.toString(),
      memberId: doc.memberId,
      surname: doc.surname,
      isLinked: doc.isLinked ?? false,
      linkStatus: doc.linkStatus ?? QantasLinkStatus.FAILED,
      linkedAt: doc.linkedAt?.toISOString?.() ?? doc.linkedAt,
      isRewarded: doc.isRewarded ?? false,
      surveysCompletedSinceLink: doc.surveysCompletedSinceLink ?? 0,
      totalPointsAwarded: doc.totalPointsAwarded ?? 0,
      greenTierUnlocked: doc.greenTierUnlocked ?? false,
      expirationDate: doc.expirationDate?.toISOString?.() ?? null,
      link_response: {
        qffReference: {
          memberId: doc.memberId,
        },
      },
    };
  }
}