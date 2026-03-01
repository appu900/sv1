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
  QantasConflictError,
  QantasRetryableError,
  QantasApiError,
  QantasMemberInactiveError,
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
      throw new BadRequestException('Qantas Frequent Flyer integration is currently disabled.');
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

    let existingProfile = await this.qantasFFNModel.findOne({
      userId: userIdObj,
      memberId: dto.memberId,
      isDeleted: { $in: [true, false] },
      linkStatus: QantasLinkStatus.UNLINKED,
    });

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

    let validationResponse: any;
    try {
      validationResponse = await this.qantasApiClient.validateMember(
        dto.memberId,
        dto.surname,
      );
    } catch (error) {
      if (error instanceof QantasMemberInactiveError) {
        this.logger.warn(`FFN ${dto.memberId} not found or inactive on Qantas side`);
        throw new BadRequestException(
          'The Qantas Frequent Flyer number could not be verified. Please check your details.',
        );
      }

      // Surface more specific failure reason
      if (error instanceof QantasApiError) {
        const isAkamaiBlock =
          error.responseBody.includes('Access Denied') ||
          error.responseBody.includes('akamai');

        this.logger.error(
          `Qantas validation API failed [${error.statusCode}] ` +
            `akamai=${isAkamaiBlock} body=${error.responseBody.substring(0, 500)}`,
        );

        if (isAkamaiBlock) {
          throw new BadRequestException(
            'Qantas API is not reachable from this server (blocked by CDN). ' +
              'The server IP may need to be whitelisted with Qantas.',
          );
        }

        if (error.statusCode === 401) {
          throw new BadRequestException(
            'Qantas API credentials are invalid. Please contact support.',
          );
        }

        throw new BadRequestException(
          `Qantas API returned an error (${error.statusCode}). Please try again later.`,
        );
      }

      this.logger.error('Qantas member validation API call failed', error);
      throw new BadRequestException(
        'Unable to verify your Qantas Frequent Flyer details. Please try again later.',
      );
    }

    if (validationResponse.status === 'INACTIVE') {
      throw new BadRequestException(
        'Your Qantas Frequent Flyer membership is inactive. Please contact Qantas support.',
      );
    }

    if (validationResponse.status === 'NO_ONLINE_ACCESS') {
      throw new BadRequestException(
        'Your Qantas Frequent Flyer account does not have online access enabled. Please enable it via Qantas.',
      );
    }

    const linkResponse = {
      status: validationResponse.status,
      message: validationResponse.message,
      validatedAt: new Date().toISOString(),
    };

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

  async unlinkFFN(userId: string): Promise<{ success: boolean; message: string }> {
    const userIdObj = new Types.ObjectId(userId);

    const profile = await this.qantasFFNModel.findOne({
      userId: userIdObj,
      isLinked: true,
      isDeleted: false,
    });

    if (!profile) {
      throw new NotFoundException('No linked Qantas account found.');
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

    const surveysCount = await this.getSurveyCountSinceLinking(userId, ffn.linkedAt);

    const allocations = await this.allocationModel
      .find({ userQantasProfileId: profileId, isDeleted: false })
      .sort({ createdAt: -1 })
      .lean();

    const pointsHistory = allocations
      .filter((a) => a.status === QantasAllocationStatus.ACCEPTED)
      .map((a) => ({
        points: this.pointsPerChallenge,
        reason: a.reason,
        awardedAt: a.processedAt?.toISOString() ?? (a as any).createdAt?.toISOString(),
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

  async onSurveyCompleted(userId: string, surveyId: string): Promise<void> {
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
      status: { $in: [QantasAllocationStatus.PENDING, QantasAllocationStatus.ACCEPTED] },
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

    this.logger.log(`Found ${pendingAllocations.length} pending Qantas allocations to process`);

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

    // Look up user to get firstName (optional for accrual API)
    const user = await this.userModel.findById(profile.userId).lean();
    const firstName = user?.name?.split(' ')[0] ?? undefined;

    try {
      const accrualResult = await this.qantasApiClient.accruePoints({
        memberId: profile.memberId,
        firstName,
        lastName: profile.surname,
        basePoints: this.pointsPerChallenge,
        referenceNumber: allocation._id.toString(),
      });

      allocation.status = QantasAllocationStatus.ACCEPTED;
      allocation.processedAt = new Date();
      allocation.accrualReferenceNumber = accrualResult.accrualReferenceNumber;
      allocation.qantasResponse = accrualResult;
      await allocation.save();

      profile.isRewarded = true;
      profile.greenTierUnlocked = true;
      profile.totalPointsAwarded += this.pointsPerChallenge;
      await profile.save();

      this.logger.log(
        `Awarded ${this.pointsPerChallenge} Qantas points to member ${profile.memberId} ` +
          `(allocation ${allocation._id}, accrualRef ${accrualResult.accrualReferenceNumber})`,
      );
    } catch (error) {
      if (error instanceof QantasConflictError) {
        allocation.status = QantasAllocationStatus.ACCEPTED;
        allocation.processedAt = new Date();
        allocation.qantasResponse = { note: 'Duplicate accrual (409)', error: error.responseBody };
        await allocation.save();
        this.logger.warn(
          `Qantas allocation ${allocation._id} was already processed (409 conflict)`,
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
          `Retryable error claiming allocation ${allocation._id} (attempt ${allocation.retryCount}/3): ${error.message}`,
        );
        return;
      }

      allocation.status = QantasAllocationStatus.REJECTED;
      allocation.processedAt = new Date();
      allocation.qantasResponse = {
        error: error instanceof QantasApiError ? error.responseBody : String(error),
      };
      await allocation.save();

      this.logger.error(
        `Failed to claim Qantas points for allocation ${allocation._id}`,
        error,
      );
    }
  }

  async cancelAccrual(allocationId: string): Promise<any> {
    const allocation = await this.allocationModel.findById(allocationId);
    if (!allocation) throw new NotFoundException('Allocation not found');
    if (!allocation.accrualReferenceNumber) {
      throw new BadRequestException('No accrual reference number to cancel');
    }

    const profile = await this.qantasFFNModel.findById(allocation.userQantasProfileId);
    if (!profile) throw new NotFoundException('FFN profile not found');

    const result = await this.qantasApiClient.cancelAccrual({
      accrualReferenceNumber: allocation.accrualReferenceNumber,
      memberId: profile.memberId,
      lastName: profile.surname,
    });

    allocation.status = QantasAllocationStatus.REJECTED;
    allocation.processedAt = new Date();
    allocation.qantasResponse = { ...allocation.qantasResponse, cancelResult: result };
    await allocation.save();

    // Roll back profile rewards
    profile.isRewarded = false;
    profile.totalPointsAwarded = Math.max(0, profile.totalPointsAwarded - this.pointsPerChallenge);
    await profile.save();

    this.logger.log(
      `Cancelled accrual ${allocation.accrualReferenceNumber} for member ${profile.memberId}`,
    );

    return result;
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
      this.logger.log(`Reset rewards for member ${profile.memberId} — new membership year`);
    }

    this.logger.log(`Reset rewards for ${expiredProfiles.length} expired memberships`);
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
