import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cuisine, CuisineDocument } from '../../database/schemas/cuisine.schema';
import { CreateCuisineDto } from './dto/create-cuisine.dto';
import { UpdateCuisineDto } from './dto/update-cuisine.dto';
import { RedisService } from '../../redis/redis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';

@Injectable()
export class CuisineService {
  private readonly CACHE_TTL = 1200;
  private readonly CACHE_KEY_ALL = 'cuisines:all';
  private readonly CACHE_KEY_ALL_ACTIVE = 'cuisines:all:active';
  private readonly CACHE_KEY_SINGLE = 'cuisines:single';
  private readonly UPLOAD_FOLDER = 'saveful/cuisine';
  private readonly ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);

  constructor(
    @InjectModel(Cuisine.name)
    private readonly cuisineModel: Model<CuisineDocument>,
    private readonly redisService: RedisService,
    private readonly imageUploadService: ImageUploadService,
  ) {}

  async create(
    createDto: CreateCuisineDto,
    files?: { image?: Express.Multer.File[] },
  ): Promise<Cuisine> {
    const title = createDto.title.trim();
    await this.assertTitleAvailable(title);

    try {
      const imageUrl = await this.uploadImageIfPresent(files?.image?.[0]);

      const cuisine = await this.cuisineModel.create({
        title,
        description: createDto.description,
        imageUrl,
        order: createDto.order ?? 0,
        isActive: createDto.isActive ?? true,
      });

      await this.clearListCaches();
      return cuisine.toObject();
    } catch (error) {
      this.rethrowWriteError(error, 'create');
    }
  }

  async findAll(activeOnly = true): Promise<Cuisine[]> {
    const cacheKey = activeOnly ? this.CACHE_KEY_ALL_ACTIVE : this.CACHE_KEY_ALL;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      await this.redisService.del(cacheKey);
    }

    const query = activeOnly ? { isActive: true } : {};
    const cuisines = await this.cuisineModel
      .find(query)
      .sort({ order: 1, title: 1 })
      .lean()
      .exec();

    await this.redisService.set(
      cacheKey,
      JSON.stringify(cuisines),
      this.CACHE_TTL,
    );

    return cuisines;
  }

  async findOne(id: string): Promise<Cuisine> {
    this.assertValidObjectId(id);

    const cacheKey = `${this.CACHE_KEY_SINGLE}:${id}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      await this.redisService.del(cacheKey);
    }

    const cuisine = await this.cuisineModel.findById(id).lean().exec();
    if (!cuisine) {
      throw new NotFoundException(`Cuisine with ID ${id} not found`);
    }

    await this.redisService.set(
      cacheKey,
      JSON.stringify(cuisine),
      this.CACHE_TTL,
    );

    return cuisine;
  }

  async update(
    id: string,
    updateDto: UpdateCuisineDto,
    files?: { image?: Express.Multer.File[] },
  ): Promise<Cuisine> {
    this.assertValidObjectId(id);

    const existing = await this.cuisineModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException(`Cuisine with ID ${id} not found`);
    }

    const updateData: Record<string, unknown> = {};

    if (updateDto.title !== undefined) {
      const title = updateDto.title.trim();
      if (title !== existing.title) {
        await this.assertTitleAvailable(title, id);
      }
      updateData.title = title;
    }

    if (updateDto.description !== undefined) {
      updateData.description = updateDto.description;
    }
    if (updateDto.order !== undefined) {
      updateData.order = updateDto.order;
    }
    if (updateDto.isActive !== undefined) {
      updateData.isActive = updateDto.isActive;
    }

    const previousImageUrl = existing.imageUrl;
    const uploadedImageUrl = await this.uploadImageIfPresent(files?.image?.[0]);
    if (uploadedImageUrl) {
      updateData.imageUrl = uploadedImageUrl;
    }

    try {
      const updatedCuisine = await this.cuisineModel
        .findByIdAndUpdate(id, updateData, { new: true })
        .lean()
        .exec();

      if (!updatedCuisine) {
        throw new NotFoundException(`Cuisine with ID ${id} not found after update`);
      }

      if (uploadedImageUrl && previousImageUrl) {
        await this.imageUploadService.deleteFile(previousImageUrl);
      }

      await this.clearListCaches();
      await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);

      return updatedCuisine;
    } catch (error) {
      this.rethrowWriteError(error, 'update');
    }
  }

  async remove(id: string): Promise<void> {
    this.assertValidObjectId(id);

    const cuisine = await this.cuisineModel.findById(id).exec();
    if (!cuisine) {
      throw new NotFoundException(`Cuisine with ID ${id} not found`);
    }

    await this.cuisineModel.findByIdAndDelete(id).exec();

    if (cuisine.imageUrl) {
      await this.imageUploadService.deleteFile(cuisine.imageUrl);
    }

    await this.clearListCaches();
    await this.redisService.del(`${this.CACHE_KEY_SINGLE}:${id}`);
  }

  private assertValidObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid cuisine ID format');
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async assertTitleAvailable(
    title: string,
    excludeId?: string,
  ): Promise<void> {
    const query: Record<string, unknown> = {
      title: {
        $regex: new RegExp(`^${this.escapeRegex(title)}$`, 'i'),
      },
    };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existing = await this.cuisineModel.findOne(query).select('_id').lean();
    if (existing) {
      throw new ConflictException(`Cuisine with title "${title}" already exists`);
    }
  }

  private async uploadImageIfPresent(
    file?: Express.Multer.File,
  ): Promise<string | undefined> {
    if (!file) return undefined;

    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded image is empty');
    }

    if (!this.ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Invalid image type. Allowed: jpeg, png, webp, gif',
      );
    }

    return this.imageUploadService.uploadFile(file, this.UPLOAD_FOLDER);
  }

  private async clearListCaches(): Promise<void> {
    await Promise.all([
      this.redisService.del(this.CACHE_KEY_ALL),
      this.redisService.del(this.CACHE_KEY_ALL_ACTIVE),
    ]);
  }

  private rethrowWriteError(error: unknown, action: 'create' | 'update'): never {
    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof BadRequestException
    ) {
      throw error;
    }

    const mongoError = error as { code?: number; message?: string };
    if (mongoError?.code === 11000) {
      throw new ConflictException('Cuisine with this title already exists');
    }

    throw new BadRequestException(
      `Failed to ${action} cuisine: ${mongoError?.message || 'Unknown error'}`,
    );
  }
}
