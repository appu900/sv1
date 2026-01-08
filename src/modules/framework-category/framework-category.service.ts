import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FrameworkCategory,
  FrameworkCategoryDocument,
} from '../../database/schemas/framework-category.schema';
import { CreateFrameworkCategoryDto } from './dto/create-framework-category.dto';
import { UpdateFrameworkCategoryDto } from './dto/update-framework-category.dto';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class FrameworkCategoryService {
  private readonly CACHE_TTL = 1200; // 20 minutes
  private readonly CACHE_KEY_ALL = 'framework-categories:all';
  private readonly CACHE_KEY_SINGLE = 'framework-categories:single';

  constructor(
    @InjectModel(FrameworkCategory.name)
    private frameworkCategoryModel: Model<FrameworkCategoryDocument>,
    private readonly redisService: RedisService,
  ) {}

  async create(
    createDto: CreateFrameworkCategoryDto,
  ): Promise<FrameworkCategory> {
    try {
      // Check if title already exists
      const existing = await this.frameworkCategoryModel.findOne({
        title: createDto.title,
      });

      if (existing) {
        throw new ConflictException(
          `Framework category with title "${createDto.title}" already exists`,
        );
      }

      const category = new this.frameworkCategoryModel(createDto);
      const savedCategory = await category.save();

      // Clear cache
      await this.redisService.del(this.CACHE_KEY_ALL);

      return savedCategory;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to create framework category: ${error.message}`,
      );
    }
  }

  async findAll(): Promise<FrameworkCategory[]> {
    try {
      const cached = await this.redisService.get(this.CACHE_KEY_ALL);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error(
        'Error parsing cached framework categories, clearing cache:',
        error.message,
      );
      await this.redisService.del(this.CACHE_KEY_ALL);
    }

    const categories = await this.frameworkCategoryModel
      .find({ isActive: true })
      .sort({ order: 1, title: 1 })
      .lean()
      .exec();

    await this.redisService.set(
      this.CACHE_KEY_ALL,
      JSON.stringify(categories),
      this.CACHE_TTL,
    );

    return categories;
  }

  async findOne(id: string): Promise<FrameworkCategory> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid framework category ID format');
    }

    const cacheKey = `${this.CACHE_KEY_SINGLE}:${id}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error(
        'Error parsing cached framework category, clearing cache:',
        error.message,
      );
      await this.redisService.del(cacheKey);
    }

    const category = await this.frameworkCategoryModel
      .findById(id)
      .lean()
      .exec();

    if (!category) {
      throw new NotFoundException(
        `Framework category with ID ${id} not found`,
      );
    }

    await this.redisService.set(
      cacheKey,
      JSON.stringify(category),
      this.CACHE_TTL,
    );

    return category;
  }

  async update(
    id: string,
    updateDto: UpdateFrameworkCategoryDto,
  ): Promise<FrameworkCategory> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid framework category ID format');
    }

    const existing = await this.frameworkCategoryModel.findById(id);
    if (!existing) {
      throw new NotFoundException(
        `Framework category with ID ${id} not found`,
      );
    }

    // Check if new title conflicts with another category
    if (updateDto.title && updateDto.title !== existing.title) {
      const duplicate = await this.frameworkCategoryModel.findOne({
        title: updateDto.title,
        _id: { $ne: id },
      });

      if (duplicate) {
        throw new ConflictException(
          `Framework category with title "${updateDto.title}" already exists`,
        );
      }
    }

    try {
      const updatedCategory = await this.frameworkCategoryModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .lean()
        .exec();

      if (!updatedCategory) {
        throw new NotFoundException(
          `Framework category with ID ${id} not found after update`,
        );
      }

      // Clear cache
      await this.redisService.del(this.CACHE_KEY_ALL);
      await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);

      return updatedCategory;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to update framework category: ${error.message}`,
      );
    }
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid framework category ID format');
    }

    const category = await this.frameworkCategoryModel.findById(id);
    if (!category) {
      throw new NotFoundException(
        `Framework category with ID ${id} not found`,
      );
    }

    await this.frameworkCategoryModel.findByIdAndDelete(id).exec();

    // Clear cache
    await this.redisService.del(this.CACHE_KEY_ALL);
    await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);
  }
}
