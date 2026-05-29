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
import {
  UserFoodAnalyticalProfileDocument,
  UserFoodAnalyticsProfile,
} from 'src/database/schemas/user.food.analyticsProfile.schema';

@Injectable()
export class UserService {
  private logger = new Logger(UserService.name);
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserFoodAnalyticsProfile.name)
    private readonly UserFoodProfileModel: Model<UserFoodAnalyticalProfileDocument>,
  ) {}

  async findByEmail(email: string) {
    const user = await this.userModel.findOne({ email });
    return user;
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

    const updateData: any = {
      dietaryProfile: {
        vegType: dto.vegType || 'OMNI',
        dairyFree: dto.dairyFree ?? false,
        nutFree: dto.nutFree ?? false,
        glutenFree: dto.glutenFree ?? false,
        hasDiabetes: dto.hasDiabetes ?? false,
        otherAllergies: dto.otherAllergies || [],
        noOfAdults: dto.noOfAdults ?? 0,
        noOfChildren: dto.noOfChildren ?? 0,
        tastePrefrence: [],
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
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const result = await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(userId),
        { $set: { name } },
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
