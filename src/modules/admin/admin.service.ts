import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserRole } from 'src/database/schemas/user.auth.schema';
import { CreateChefDto } from './dto/create-chef.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async createChef(dto: CreateChefDto) {
    const existingChef = await this.userModel.findOne({ email: dto.email });
    if (existingChef) {
      throw new BadRequestException('Chef with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const chef = await this.userModel.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: UserRole.CHEF,
    });

    return {
      success: true,
      message: 'Chef created successfully',
      chef: {
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      },
    };
  }

  async getAllChefs() {
    const chefs = await this.userModel
      .find({ role: UserRole.CHEF })
      .select('-passwordHash')
      .lean();

    return {
      chefs: chefs.map((chef) => ({
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      })),
    };
  }

  async getChefById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid chef ID');
    }

    const chef = await this.userModel
      .findOne({ _id: new Types.ObjectId(id), role: UserRole.CHEF })
      .select('-passwordHash')
      .lean();

    if (!chef) {
      throw new NotFoundException('Chef not found');
    }

    return {
      chef: {
        id: chef._id,
        email: chef.email,
        name: chef.name,
        role: chef.role,
        createdAt: chef['createdAt'],
        updatedAt: chef['updatedAt'],
      },
    };
  }

  async deleteChef(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid chef ID');
    }

    const chef = await this.userModel.findOne({
      _id: new Types.ObjectId(id),
      role: UserRole.CHEF,
    });

    if (!chef) {
      throw new NotFoundException('Chef not found');
    }

    await this.userModel.deleteOne({ _id: new Types.ObjectId(id) });

    return {
      success: true,
      message: 'Chef deleted successfully',
    };
  }

  async getAllUsers() {
    const users = await this.userModel
      .find({ role: UserRole.USER })
      .select('-passwordHash')
      .lean();

    return {
      users: users.map((user) => ({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        country: user.country,
        stateCode: user.stateCode,
        dietaryProfile: user.dietaryProfile ? {
          vegType: user.dietaryProfile.vegType,
          dairyFree: user.dietaryProfile.dairyFree,
          nutFree: user.dietaryProfile.nutFree,
          glutenFree: user.dietaryProfile.glutenFree,
          hasDiabetes: user.dietaryProfile.hasDiabetes,
          otherAllergies: user.dietaryProfile.otherAllergies || [],
        } : null,
        onboarding: user.country ? {
          noOfAdults: user.dietaryProfile?.noOfAdults || 1,
          noOfChildren: user.dietaryProfile?.noOfChildren || 0,
          country: user.country,
          stateCode: user.stateCode,
        } : null,
        createdAt: user['createdAt'],
        updatedAt: user['updatedAt'],
        _count: {
          cookedRecipes: 0, 
          bookmarkedRecipes: 0, 
        },
      })),
    };
  }

  async getUserById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(id), role: UserRole.USER })
      .select('-passwordHash')
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        country: user.country,
        stateCode: user.stateCode,
        dietaryProfile: user.dietaryProfile ? {
          vegType: user.dietaryProfile.vegType,
          dairyFree: user.dietaryProfile.dairyFree,
          nutFree: user.dietaryProfile.nutFree,
          glutenFree: user.dietaryProfile.glutenFree,
          hasDiabetes: user.dietaryProfile.hasDiabetes,
          otherAllergies: user.dietaryProfile.otherAllergies || [],
        } : null,
        onboarding: user.country ? {
          noOfAdults: user.dietaryProfile?.noOfAdults || 1,
          noOfChildren: user.dietaryProfile?.noOfChildren || 0,
          country: user.country,
          stateCode: user.stateCode,
        } : null,
        createdAt: user['createdAt'],
        updatedAt: user['updatedAt'],
        _count: {
          cookedRecipes: 0, // TODO: implement actual count from recipes
          bookmarkedRecipes: 0, // TODO: implement actual count from bookmarks
        },
      },
    };
  }

  async deleteUser(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(id),
      role: UserRole.USER,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userModel.deleteOne({ _id: new Types.ObjectId(id) });

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  async getStats() {
    const totalUsers = await this.userModel.countDocuments({
      role: UserRole.USER,
    });

    const totalChefs = await this.userModel.countDocuments({
      role: UserRole.CHEF,
    });

    const usersWithDietaryProfile = await this.userModel.countDocuments({
      role: UserRole.USER,
      'dietaryProfile.vegType': { $exists: true },
    });

    const usersWithCountry = await this.userModel.countDocuments({
      role: UserRole.USER,
      country: { $exists: true, $ne: null },
    });

    const dietaryProfileCompletionRate =
      totalUsers > 0
        ? `${((usersWithDietaryProfile / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    const onboardingCompletionRate =
      totalUsers > 0
        ? `${((usersWithCountry / totalUsers) * 100).toFixed(1)}%`
        : '0%';

    return {
      totalUsers,
      totalChefs,
      usersWithDietaryProfile,
      dietaryProfileCompletionRate,
      usersWithOnboarding: usersWithCountry,
      onboardingCompletionRate,
    };
  }
}
