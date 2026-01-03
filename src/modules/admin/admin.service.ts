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
    // Check if chef already exists
    const existingChef = await this.userModel.findOne({ email: dto.email });
    if (existingChef) {
      throw new BadRequestException('Chef with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Create chef user
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
        createdAt: user['createdAt'],
        updatedAt: user['updatedAt'],
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
        dietaryProfile: user.dietaryProfile,
        createdAt: user['createdAt'],
        updatedAt: user['updatedAt'],
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
}
