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


@Injectable()
export class UserService {
  private logger = new Logger(UserService.name);
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
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

  async updateProfile(dto: UserProfileDto, userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('invalid userId');
    const user = await this.userModel.findById(new Types.ObjectId(userId));
    if (!user) throw new BadRequestException('can not perform this operation');

    const result = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          country: dto.country,
          dietaryProfile: {
            vegType: dto.vegType,
            dairyFree: dto.dairyFree,
            nutFree: dto.nutFree,
            glutenFree: dto.glutenFree,
            hasDiabetes: dto.hasDiabetes,
            otherAllergies: dto.allergies ?? [],
            noOfAdults: dto.noOfAdults ?? 0,
            noOfChildren: dto.noOfChildren ?? 0,
            tastePrefrence: [],
          },
        },
      },
      { new: true },
    );
    if (!result) {
      throw new BadRequestException('can not perform this operation');
    }
    return {
      message: 'Profile update successfully',
      dietaryProfile: user.dietaryProfile,
    };
  }
}
