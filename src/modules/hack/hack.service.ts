import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { InjectModel } from '@nestjs/mongoose';
import {
  HackCategoryDocument,
  Hackscategory,
} from 'src/database/schemas/hacks.category.schema';
import { Model } from 'mongoose';
import { CreateHackCategoryDto } from './dto/Create.hack.category.dto';
import { Types } from 'mongoose';
import { HackDocument, Hacks } from 'src/database/schemas/hacks.schema';
import { RedisService } from 'src/redis/redis.service';
import { CreateHackDto } from './dto/Create.hack.dto';
import { UpdateHackDto } from './dto/Update.hack.dto';
import { threadCpuUsage } from 'process';
import { JsonWebTokenError } from 'jsonwebtoken';

@Injectable()
export class HackService {
  constructor(
    @InjectModel(Hackscategory.name)
    private readonly hacksCategory: Model<HackCategoryDocument>,
    @InjectModel(Hacks.name) private readonly hackModel: Model<HackDocument>,
    private readonly imageUploadService: ImageUploadService,
    private readonly redisService: RedisService,
  ) {}

  async createHackCategory(
    dto: CreateHackCategoryDto,
    files: { heroImage: Express.Multer.File[]; iconImage: Express.Multer.File[] },
  ) {
    let heroImageUrl = '';
    let iconImageUrl = '';
    
    if (files?.heroImage?.[0]) {
      heroImageUrl = await this.imageUploadService.uploadFile(
        files.heroImage[0],
        'saveful/hack-category/hero',
      );
    }
    
    if (files?.iconImage?.[0]) {
      iconImageUrl = await this.imageUploadService.uploadFile(
        files.iconImage[0],
        'saveful/hack-category/icons',
      );
    }
    
    const result = await this.hacksCategory.create({
      name: dto.name,
      heroImageUrl: heroImageUrl,
      iconImageUrl: iconImageUrl,
    });
    const cacheKey = `hacks:category:all`
    await this.redisService.del(cacheKey)
    return {
      message: 'hacks category created successfully',
      result,
    };
  }

  async getAllCategory() {
    const cacheKey = `hacks:category:all`
    const cached = await this.redisService.get(cacheKey)
    if(cached) return cached
    const categories = await this.hacksCategory.find().lean()
    await this.redisService.set(cacheKey,categories,60 * 30)
    return categories
  }

  async getHacksByCategoryId(hackId: string) {
    if (!Types.ObjectId.isValid(hackId)) {
      throw new BadRequestException('Invalid category id');
    }

    const cachedKey = `hacks:category:${hackId}`;
    const cached = await this.redisService.get(cachedKey);
    if (cached) {
      return cached;
    }
    const hackCategory = await this.hacksCategory.findById(
      new Types.ObjectId(hackId),
    );
    if (!hackCategory)
      throw new BadRequestException('category not exists in db');
    const hacks = await this.hackModel
      .find({ categoryId: hackCategory._id })
      .populate('sponsorId')
      .lean();
    const response = {
      category: {
        id: hackCategory._id,
        name: hackCategory.name,
        heroImageUrl: hackCategory.heroImageUrl,
        iconImageUrl: hackCategory.iconImageUrl,
      },
      hacks,
    };
    await this.redisService.set(cachedKey, response, 60 * 10);
    return {
      response,
    };
  }

  //   ** hacks service

  async createHack(
    dto: CreateHackDto,
    files?: Express.Multer.File[],
  ) {
    if (!Types.ObjectId.isValid(dto.categoryId)) {
      throw new BadRequestException('Invalid Category Id');
    }
    const category = await this.hacksCategory.findById(dto.categoryId);
    if (!category) {
      throw new BadRequestException('category does not exists');
    }

    // Organize files by fieldname
    const fileMap = new Map<string, Express.Multer.File>();
    files?.forEach(file => {
      fileMap.set(file.fieldname, file);
    });

    // Upload images if provided
    let thumbnailImageUrl: string | undefined;
    let heroImageUrl: string | undefined;
    let iconImageUrl: string | undefined;

    const thumbnailFile = fileMap.get('thumbnailImage');
    if (thumbnailFile) {
      thumbnailImageUrl = await this.imageUploadService.uploadFile(
        thumbnailFile,
        'saveful/hacks/thumbnails',
      );
    }

    const heroFile = fileMap.get('heroImage');
    if (heroFile) {
      heroImageUrl = await this.imageUploadService.uploadFile(
        heroFile,
        'saveful/hacks/hero-images',
      );
    }

    const iconFile = fileMap.get('iconImage');
    if (iconFile) {
      iconImageUrl = await this.imageUploadService.uploadFile(
        iconFile,
        'saveful/hacks/icons',
      );
    }

    // Process and validate article blocks
    const processedBlocks = await this.processArticleBlocksWithThumbnails(
      dto.articleBlocks,
      fileMap,
    );

    const hack = await this.hackModel.create({
      title: dto.title,
      shortDescription: dto.shortDescription,
      description: dto.description,
      leadText: dto.leadText,
      categoryId: category._id,
      sponsorId: (dto.sponsorId && Types.ObjectId.isValid(dto.sponsorId))
        ? new Types.ObjectId(dto.sponsorId)
        : undefined,
      thumbnailImageUrl,
      heroImageUrl,
      iconImageUrl,
      articleBlocks: processedBlocks,
    });

    const cachedKey = `hacks:single:${hack._id}`;
    await this.redisService.set(cachedKey, JSON.stringify(hack), 60 * 20);
    await this.redisService.del(`hacks:category:${dto.categoryId}`);

    return {
      message: 'hack created successfully',
      hackId: hack._id,
    };
  }

  /**
   * Process and validate article blocks with proper ordering
   */
  private processArticleBlocks(blocks: any[]): any[] {
    return blocks.map((block, index) => {
      const processedBlock = {
        ...block,
        order: index, // Sequential ordering
        id: block.id || new Types.ObjectId().toString(),
      };

      // Validate block structure based on type
      switch (block.type) {
        case 'text':
          if (!block.text) {
            throw new BadRequestException(
              `Text block at position ${index} is missing text content`,
            );
          }
          break;
        case 'image':
          if (!block.imageUrl) {
            throw new BadRequestException(
              `Image block at position ${index} is missing imageUrl`,
            );
          }
          break;
        case 'video':
          if (!block.videoUrl) {
            throw new BadRequestException(
              `Video block at position ${index} is missing videoUrl`,
            );
          }
          break;
        case 'list':
          if (!block.listTitle || !block.listItems) {
            throw new BadRequestException(
              `List block at position ${index} is missing required fields`,
            );
          }
          break;
        case 'accordion':
          if (!block.accordion || !Array.isArray(block.accordion)) {
            throw new BadRequestException(
              `Accordion block at position ${index} is missing accordion items`,
            );
          }
          break;
        case 'image_details':
          if (!block.blockImageUrl || !block.blockTitle) {
            throw new BadRequestException(
              `Image details block at position ${index} is missing required fields`,
            );
          }
          break;
        default:
          // Allow other block types
          break;
      }

      return processedBlock;
    });
  }

  /**
   * Process article blocks and upload video thumbnails to S3
   */
  private async processArticleBlocksWithThumbnails(
    blocks: any[],
    fileMap: Map<string, Express.Multer.File>,
  ): Promise<any[]> {
    const processedBlocks = await Promise.all(
      blocks.map(async (block, index) => {
        const processedBlock = {
          ...block,
          order: index,
          id: block.id || new Types.ObjectId().toString(),
        };

        // Upload video thumbnail if provided
        if (block.type === 'video') {
          const thumbnailFile = fileMap.get(`videoThumbnail_${block.id}`);
          if (thumbnailFile) {
            processedBlock.videoThumbnail = await this.imageUploadService.uploadFile(
              thumbnailFile,
              'saveful/hacks/video-thumbnails',
            );
          }
        }

        // Upload image for image block if provided
        if (block.type === 'image') {
          const imageFile = fileMap.get(`blockImage_${block.id}`);
          if (imageFile) {
            processedBlock.imageUrl = await this.imageUploadService.uploadFile(
              imageFile,
              'saveful/hacks/block-images',
            );
          }
        }

        // Upload image for image details block if provided
        if (block.type === 'image_details') {
          const imageFile = fileMap.get(`blockImage_${block.id}`);
          if (imageFile) {
            processedBlock.blockImageUrl = await this.imageUploadService.uploadFile(
              imageFile,
              'saveful/hacks/block-images',
            );
          }
        }

        // Validate block structure
        switch (block.type) {
          case 'text':
            if (!block.text) {
              throw new BadRequestException(
                `Text block at position ${index} is missing text content`,
              );
            }
            break;
          case 'image':
            if (!block.imageUrl && !fileMap.get(`blockImage_${block.id}`)) {
              throw new BadRequestException(
                `Image block at position ${index} is missing imageUrl or image file`,
              );
            }
            break;
          case 'video':
            if (!block.videoUrl) {
              throw new BadRequestException(
                `Video block at position ${index} is missing videoUrl`,
              );
            }
            break;
          case 'list':
            if (!block.listTitle || !block.listItems) {
              throw new BadRequestException(
                `List block at position ${index} is missing required fields`,
              );
            }
            break;
          case 'accordion':
            if (!block.accordion || !Array.isArray(block.accordion)) {
              throw new BadRequestException(
                `Accordion block at position ${index} is missing accordion items`,
              );
            }
            break;
          case 'image_details':
            if ((!block.blockImageUrl && !fileMap.get(`blockImage_${block.id}`)) || !block.blockTitle) {
              throw new BadRequestException(
                `Image details block at position ${index} is missing required fields`,
              );
            }
            break;
          default:
            break;
        }

        return processedBlock;
      }),
    );

    return processedBlocks;
  }

  async getHackById(hackId: string) {
    if (!Types.ObjectId.isValid(hackId))
      throw new BadRequestException('Invalid hack id');
    const cacheKey = `hacks:single:${hackId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;
    const hack = await this.hackModel.findById(hackId).populate('sponsorId').lean();
    if (!hack) throw new NotFoundException('Hack not found');
    await this.redisService.set(cacheKey, hack, 60 * 10);
    return hack;
  }

  async updateHack(
    hackId: string,
    dto: UpdateHackDto,
    files?: Express.Multer.File[],
  ) {
    if (!Types.ObjectId.isValid(hackId)) {
      throw new BadRequestException('Invalid hack id');
    }

    const hack = await this.hackModel.findById(hackId);
    if (!hack) {
      throw new NotFoundException('Hack not found');
    }

    // Validate category if provided
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) {
      const category = await this.hacksCategory.findById(dto.categoryId);
      if (!category) {
        throw new BadRequestException('Category does not exist');
      }
    }

    // Organize files by fieldname
    const fileMap = new Map<string, Express.Multer.File>();
    files?.forEach(file => {
      fileMap.set(file.fieldname, file);
    });

    // Upload new images if provided
    const updateData: any = {};

    const thumbnailFile = fileMap.get('thumbnailImage');
    if (thumbnailFile) {
      updateData.thumbnailImageUrl = await this.imageUploadService.uploadFile(
        thumbnailFile,
        'saveful/hacks/thumbnails',
      );
    }

    const heroFile = fileMap.get('heroImage');
    if (heroFile) {
      updateData.heroImageUrl = await this.imageUploadService.uploadFile(
        heroFile,
        'saveful/hacks/hero-images',
      );
    }

    const iconFile = fileMap.get('iconImage');
    if (iconFile) {
      updateData.iconImageUrl = await this.imageUploadService.uploadFile(
        iconFile,
        'saveful/hacks/icons',
      );
    }

    // Update text fields
    if (dto.title) updateData.title = dto.title;
    if (dto.shortDescription !== undefined)
      updateData.shortDescription = dto.shortDescription;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.leadText !== undefined) updateData.leadText = dto.leadText;
    if (dto.categoryId && Types.ObjectId.isValid(dto.categoryId)) {
      updateData.categoryId = new Types.ObjectId(dto.categoryId);
    }
    if (dto.sponsorId !== undefined) {
      if (dto.sponsorId && Types.ObjectId.isValid(dto.sponsorId)) {
        updateData.sponsorId = new Types.ObjectId(dto.sponsorId);
      } else if (!dto.sponsorId) {
        updateData.sponsorId = null;
      }
    }

    // Process article blocks if provided
    if (dto.articleBlocks) {
      updateData.articleBlocks = await this.processArticleBlocksWithThumbnails(
        dto.articleBlocks,
        fileMap,
      );
    }

    const updatedHack = await this.hackModel.findByIdAndUpdate(
      hackId,
      updateData,
      { new: true },
    );

    // Invalidate caches
    await this.redisService.del(`hacks:single:${hackId}`);
    await this.redisService.del(`hacks:category:${hack.categoryId}`);
    if (dto.categoryId && dto.categoryId !== hack.categoryId.toString()) {
      await this.redisService.del(`hacks:category:${dto.categoryId}`);
    }

    return {
      message: 'Hack updated successfully',
      hack: updatedHack,
    };
  }

  async deleteHack(hackId: string) {
    if (!Types.ObjectId.isValid(hackId)) {
      throw new BadRequestException('Invalid hack id');
    }

    const hack = await this.hackModel.findById(hackId);
    if (!hack) {
      throw new NotFoundException('Hack not found');
    }

    await this.hackModel.findByIdAndDelete(hackId);

    // Invalidate caches
    await this.redisService.del(`hacks:single:${hackId}`);
    await this.redisService.del(`hacks:category:${hack.categoryId}`);

    return {
      message: 'Hack deleted successfully',
    };
  }

  async deleteCategory(categoryId: string) {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException('Invalid category id');
    }

    const category = await this.hacksCategory.findById(categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // Check if any hacks are using this category
    const hacksUsingCategory = await this.hackModel.countDocuments({
      categoryId: new Types.ObjectId(categoryId),
    });

    if (hacksUsingCategory > 0) {
      throw new BadRequestException(
        `Cannot delete category. ${hacksUsingCategory} hack(s) are using this category.`,
      );
    }

    await this.hacksCategory.findByIdAndDelete(categoryId);

    // Invalidate caches
    await this.redisService.del(`hacks:category:all`);
    await this.redisService.del(`hacks:category:${categoryId}`);

    return {
      message: 'Category deleted successfully',
    };
  }

  async updateCategory(
    categoryId: string,
    dto: CreateHackCategoryDto,
    files?: { heroImage?: Express.Multer.File[]; iconImage?: Express.Multer.File[] },
  ) {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException('Invalid category id');
    }

    const category = await this.hacksCategory.findById(categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const updateData: any = {};
    
    if (dto.name) {
      updateData.name = dto.name;
    }
    
    if (files?.heroImage?.[0]) {
      updateData.heroImageUrl = await this.imageUploadService.uploadFile(
        files.heroImage[0],
        'saveful/hack-category/hero',
      );
    }
    
    if (files?.iconImage?.[0]) {
      updateData.iconImageUrl = await this.imageUploadService.uploadFile(
        files.iconImage[0],
        'saveful/hack-category/icons',
      );
    }

    const updatedCategory = await this.hacksCategory.findByIdAndUpdate(
      categoryId,
      updateData,
      { new: true },
    );

    // Invalidate caches
    await this.redisService.del(`hacks:category:all`);
    await this.redisService.del(`hacks:category:${categoryId}`);

    return {
      message: 'Category updated successfully',
      result: updatedCategory,
    };
  }
}
