import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';
import { UserProfileDto } from './dto/user.profile.dto';
import { SavefulPreferencesDto } from '../auth/dto/saveful-preferences.dto';
import {
  UserFoodAnalyticalProfileDocument,
  UserFoodAnalyticsProfile,
} from 'src/database/schemas/user.food.analyticsProfile.schema';
import {
  UserDietaryProfile,
} from 'src/database/schemas/user-dietary-profile.schema';
import {
  UserSavefulPreferences,
} from 'src/database/schemas/user-saveful-preferences.schema';
import { deriveSavefulPreferences } from '../auth/saveful-preferences.utils';

@Injectable()
export class UserService {
  private logger = new Logger(UserService.name);
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly UserFoodProfileModel: Model<UserFoodAnalyticalProfileDocument>,
  ) {}

  async findByEmail(email: string) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;

    // Prefer exact lowercase match, then case-insensitive for legacy mixed-case emails
    const exact = await this.userModel.findOne({ email: normalized });
    if (exact) return exact;

    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.userModel.findOne({
      email: { $regex: `^${escaped}$`, $options: 'i' },
    });
  }

  async findById(userId: string) {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid userid');
    }
    const user = await this.userModel
      .findById(new Types.ObjectId(userId))
      .lean();
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return user;
  }

  async create(data: Partial<User>) {
    try {
      this.logger.log('user creating with payload', data);
      return this.userModel.create(data);
    } catch (error) {
      this.logger.error('something went wrong in creatng a user', error);
      throw new InternalServerErrorException('something went wrong');
    }
  }

  async createUserFoodAnalyticsProfile(userId:Types.ObjectId) {
    const profileId = await this.UserFoodProfileModel.create({
      userId:userId
    });
    return profileId;
  }

  async updateProfile(dto: UserProfileDto, userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('invalid userId');
    const user = await this.userModel.findById(new Types.ObjectId(userId));
    if (!user) throw new BadRequestException('can not perform this operation');

    const existingDietaryProfile = user.dietaryProfile ?? ({} as Partial<UserDietaryProfile>);
    const updateData: any = {
      dietaryProfile: {
        vegType: dto.vegType ?? existingDietaryProfile.vegType ?? 'OMNI',
        dairyFree:
          dto.dairyFree ?? existingDietaryProfile.dairyFree ?? false,
        nutFree: dto.nutFree ?? existingDietaryProfile.nutFree ?? false,
        glutenFree:
          dto.glutenFree ?? existingDietaryProfile.glutenFree ?? false,
        hasDiabetes:
          dto.hasDiabetes ?? existingDietaryProfile.hasDiabetes ?? false,
        otherAllergies:
          dto.otherAllergies ?? existingDietaryProfile.otherAllergies ?? [],
        noOfAdults:
          dto.noOfAdults ?? existingDietaryProfile.noOfAdults ?? 0,
        noOfChildren:
          dto.noOfChildren ?? existingDietaryProfile.noOfChildren ?? 0,
        tastePrefrence: existingDietaryProfile.tastePrefrence ?? [],
      },
    };

    if (dto.country) {
      updateData.country = dto.country;
    }

    if (dto.timezone) {
      updateData.timezone = dto.timezone;
    }

    if (dto.pincode) {
      updateData.pincode = dto.pincode;
    }

    const result = await this.userModel
      .findByIdAndUpdate(userId, { $set: updateData }, { new: true })
      .lean();
    if (!result) {
      throw new BadRequestException('can not perform this operation');
    }
    return result;
  }

  async updateSavefulPreferences(dto: SavefulPreferencesDto, userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('invalid userId');
    const user = await this.userModel.findById(new Types.ObjectId(userId));
    if (!user) throw new BadRequestException('can not perform this operation');

    const existingPreferences =
      user.savefulPreferences ?? ({} as Partial<UserSavefulPreferences>);
    const focusAreas = dto.focusAreas ?? existingPreferences.focusAreas ?? [];
    const cadence = dto.cadence ?? existingPreferences.cadence;
    const selectedExperience =
      dto.selectedExperience ?? existingPreferences.selectedExperience;
    const weeklySurveyDay =
      dto.weeklySurveyDay ?? existingPreferences.weeklySurveyDay;
    const derivedPreferences = deriveSavefulPreferences({
      focusAreas,
      cadence,
    });

    const nextSavefulPreferences = {
      focusAreas,
      cadence,
      personalPlanKey:
        derivedPreferences.personalPlanKey ??
        existingPreferences.personalPlanKey,
      personalPlanVersion:
        derivedPreferences.personalPlanVersion ??
        existingPreferences.personalPlanVersion,
      recommendedExperience:
        derivedPreferences.recommendedExperience ??
        existingPreferences.recommendedExperience,
      selectedExperience,
      onboardingArchitectureTrack:
        derivedPreferences.onboardingArchitectureTrack ??
        existingPreferences.onboardingArchitectureTrack,
      weeklySurveyDay,
      updatedAt: new Date(),
    };

    const result = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { savefulPreferences: nextSavefulPreferences } },
        { new: true },
      )
      .lean();
    if (!result) {
      throw new BadRequestException('can not perform this operation');
    }
    return result;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const result = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(userId),
      { $set: { passwordHash } },
      { new: true },
    );
    if (!result) {
      throw new NotFoundException('User not found');
    }
  }

  async updateTimezone(userId: string, timezone: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid userId');
    const result = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(userId),
      { $set: { timezone } },
      { new: true },
    );
    if (!result) throw new NotFoundException('User not found');
    return { ok: true };
  }

  async updateName(userId: string, name: string) {
    return this.updateBasicProfile(userId, { name });
  }

  async updateBasicProfile(
    userId: string,
    profile: {
      name?: string;
      phoneNumber?: string | null;
      gender?: User['gender'] | null;
    },
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const updateData: Record<string, unknown> = {};
    if (profile.name !== undefined) {
      updateData.name = profile.name;
    }
    if (profile.phoneNumber !== undefined) {
      updateData.phoneNumber = profile.phoneNumber;
    }
    if (profile.gender !== undefined) {
      updateData.gender = profile.gender;
    }
    if (Object.keys(updateData).length === 0) {
      return this.findById(userId);
    }
    const result = await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(userId),
        { $set: updateData },
        { new: true },
      )
      .lean();
    if (!result) {
      throw new NotFoundException('User not found');
    }
    return result;
  }

  async deleteUser(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const result = await this.userModel.findByIdAndDelete(
      new Types.ObjectId(userId),
    );
    if (!result) {
      throw new NotFoundException('User not found');
    }
  }

  async updateEmailMarketing(userId: string, isUserSubscribed: boolean): Promise<{ ok: boolean }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const result = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(userId),
      { $set: { isUserSubscribed } },
      { new: true },
    );
    if (!result) throw new NotFoundException('User not found');
    return { ok: true };
  }

 
}
