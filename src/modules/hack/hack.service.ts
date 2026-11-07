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
import { Ingredient, IngredientDocument } from 'src/database/schemas/ingredient.schema';
import {
  parseIdList,
  parseKeywordList,
  resolveCategoryIds,
  scoreTip,
} from './tips-helpers';

@Injectable()
export class HackService {
  constructor(
    @InjectModel(Hackscategory.name)
    private readonly hacksCategory: Model<HackCategoryDocument>,
    @InjectModel(Hacks.name) private readonly hackModel: Model<HackDocument>,
    @InjectModel(Ingredient.name)
    private readonly ingredientModel: Model<IngredientDocument>,
    private readonly imageUploadService: ImageUploadService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * A tip can sit in several categories, so any write clears every category
   * listing and the search index rather than one key.
   */
  private async invalidateTipCaches(hackId?: string) {
    try {
      if (hackId) await this.redisService.del(`hacks:single:${hackId}`);
      await this.redisService.delByPattern('hacks:category:*');
      await this.redisService.del('hacks:search-index');
    } catch {
      // non-critical
    }
  }

  private toObjectIds(ids: string[]): Types.ObjectId[] {
    return ids.map(id => new Types.ObjectId(id));
  }

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
      sponsorId:
        dto.sponsorId && Types.ObjectId.isValid(dto.sponsorId)
          ? new Types.ObjectId(dto.sponsorId)
          : undefined,
      order: Number.isFinite(dto.order) ? dto.order : 0,
    });
    const cacheKey = `hacks:category:all`
    try {
      await this.redisService.del(cacheKey)
    } catch {
      // non-critical
    }
    return {
      message: 'hacks category created successfully',
      result,
    };
  }

  async getAllCategory() {
    const cacheKey = `hacks:category:all`
    try {
      const cached = await this.redisService.get(cacheKey)
      if(cached) return JSON.parse(cached)
    } catch {
      // corrupted cache or Redis down
    }
    const categories = await this.hacksCategory
      .find()
      .sort({ order: 1, name: 1 })
      .populate('sponsorId')
      .lean()
    try {
      await this.redisService.set(cacheKey, JSON.stringify(categories), 60 * 30)
    } catch {
      // non-critical
    }
    return categories
  }

  async getHacksByCategoryId(hackId: string) {
    if (!Types.ObjectId.isValid(hackId)) {
      throw new BadRequestException('Invalid category id');
    }

    const cachedKey = `hacks:category:${hackId}`;
    try {
      const cached = await this.redisService.get(cachedKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // corrupted cache or Redis down
    }
    const hackCategory = await this.hacksCategory
      .findById(new Types.ObjectId(hackId))
      .populate('sponsorId')
      .lean();
    if (!hackCategory)
      throw new BadRequestException('category not exists in db');
    const hacks = await this.hackModel
      .find({ $or: [{ categoryIds: hackCategory._id }, { categoryId: hackCategory._id }] })
      .sort({ order: 1, createdAt: -1 })
      .populate('sponsorId')
      .lean();
    const response = {
      category: {
        id: hackCategory._id,
        name: hackCategory.name,
        heroImageUrl: hackCategory.heroImageUrl,
        iconImageUrl: hackCategory.iconImageUrl,
        sponsor: (hackCategory as any).sponsorId ?? null,
      },
      hacks,
    };
    try {
      await this.redisService.set(cachedKey, JSON.stringify(response), 60 * 10);
    } catch {
      // non-critical
    }
    // Same shape on a cache hit and a miss (the app and admin read it directly).
    return response;
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
    const categoryIds = resolveCategoryIds(dto.categoryId, parseIdList(dto.categoryIds));
    const knownCategories = await this.hacksCategory.countDocuments({
      _id: { $in: this.toObjectIds(categoryIds) },
    });
    if (knownCategories !== categoryIds.length) {
      throw new BadRequestException('One or more categories do not exist');
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
      categoryIds: this.toObjectIds(categoryIds),
      keywords: parseKeywordList(dto.keywords),
      ingredientIds: this.toObjectIds(parseIdList(dto.ingredientIds)),
      sponsorId: (dto.sponsorId && Types.ObjectId.isValid(dto.sponsorId))
        ? new Types.ObjectId(dto.sponsorId)
        : undefined,
      thumbnailImageUrl,
      heroImageUrl,
      iconImageUrl,
      articleBlocks: processedBlocks,
    });

    await this.invalidateTipCaches(String(hack._id));

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
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // corrupted cache or Redis down
    }
    const hack = await this.hackModel.findById(hackId).populate('sponsorId').lean();
    if (!hack) throw new NotFoundException('Hack not found');
    try {
      await this.redisService.set(cacheKey, JSON.stringify(hack), 60 * 10);
    } catch {
      // non-critical
    }
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
    if (dto.categoryIds !== undefined || updateData.categoryId) {
      const primary = dto.categoryId && Types.ObjectId.isValid(dto.categoryId)
        ? dto.categoryId
        : hack.categoryId.toString();
      const listed = dto.categoryIds !== undefined
        ? parseIdList(dto.categoryIds)
        : (hack.categoryIds ?? []).map(id => id.toString());
      const categoryIds = resolveCategoryIds(primary, listed);
      const known = await this.hacksCategory.countDocuments({ _id: { $in: this.toObjectIds(categoryIds) } });
      if (known !== categoryIds.length) {
        throw new BadRequestException('One or more categories do not exist');
      }
      updateData.categoryId = new Types.ObjectId(categoryIds[0]);
      updateData.categoryIds = this.toObjectIds(categoryIds);
    }
    if (dto.keywords !== undefined) updateData.keywords = parseKeywordList(dto.keywords);
    if (dto.ingredientIds !== undefined) {
      updateData.ingredientIds = this.toObjectIds(parseIdList(dto.ingredientIds));
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

    await this.invalidateTipCaches(hackId);

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
    await this.invalidateTipCaches(hackId);

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
      $or: [
        { categoryId: new Types.ObjectId(categoryId) },
        { categoryIds: new Types.ObjectId(categoryId) },
      ],
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
    if (dto.sponsorId !== undefined) {
      updateData.sponsorId =
        dto.sponsorId && Types.ObjectId.isValid(dto.sponsorId)
          ? new Types.ObjectId(dto.sponsorId)
          : null;
    }
    if (Number.isFinite(dto.order)) updateData.order = dto.order;
    
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

    await this.invalidateTipCaches();

    return {
      message: 'Category updated successfully',
      result: updatedCategory,
    };
  }

  /** All tips, newest first, optionally in one category (admin list and Kitchen Tips listing). */
  async listHacks(options: { categoryId?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 20)));
    const filter: Record<string, unknown> = {};
    if (options.categoryId) {
      if (!Types.ObjectId.isValid(options.categoryId)) {
        throw new BadRequestException('Invalid category id');
      }
      const id = new Types.ObjectId(options.categoryId);
      filter.$or = [{ categoryIds: id }, { categoryId: id }];
    }
    const [items, total] = await Promise.all([
      this.hackModel
        .find(filter)
        .sort({ order: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-articleBlocks')
        .populate('sponsorId')
        .lean(),
      this.hackModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Kitchen Tips search by title, key words, category names and ingredient
   * names. The tip catalogue is small, so a light index is cached and
   * scored in memory.
   */
  async searchHacks(query: string, categoryId?: string, limit = 30) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return { query: q, results: [] };

    const index = await this.getSearchIndex();
    const results = index.tips
      .filter(tip => !categoryId || tip.categoryIds.includes(categoryId))
      .map(tip => ({
        tip,
        score: scoreTip(
          tip,
          q,
          tip.categoryIds.map(id => index.categoryNames[id]).filter(Boolean),
          tip.ingredientIds.map(id => index.ingredientNames[id]).filter(Boolean),
        ),
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || a.tip.title.localeCompare(b.tip.title))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map(r => r.tip);
    return { query: q, results };
  }

  private async getSearchIndex(): Promise<{
    tips: Array<{
      _id: string;
      title: string;
      shortDescription?: string;
      thumbnailImageUrl?: string;
      heroImageUrl?: string;
      keywords: string[];
      categoryIds: string[];
      ingredientIds: string[];
      sponsorId?: unknown;
    }>;
    categoryNames: Record<string, string>;
    ingredientNames: Record<string, string>;
  }> {
    const cacheKey = 'hacks:search-index';
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // corrupted cache or Redis down
    }
    const [hacks, categories] = await Promise.all([
      this.hackModel
        .find()
        .select('title shortDescription thumbnailImageUrl heroImageUrl keywords categoryId categoryIds ingredientIds sponsorId')
        .populate('sponsorId')
        .lean(),
      this.hacksCategory.find().select('name').lean(),
    ]);
    const ingredientIdSet = new Set<string>();
    for (const h of hacks as any[]) {
      for (const id of h.ingredientIds ?? []) ingredientIdSet.add(String(id));
    }
    const ingredients = ingredientIdSet.size
      ? await this.ingredientModel
          .find({ _id: { $in: [...ingredientIdSet].map(id => new Types.ObjectId(id)) } })
          .select('name')
          .lean()
      : [];
    const index = {
      tips: (hacks as any[]).map(h => {
        const cats = (h.categoryIds?.length ? h.categoryIds : [h.categoryId]).filter(Boolean).map(String);
        return {
          _id: String(h._id),
          title: h.title,
          shortDescription: h.shortDescription,
          thumbnailImageUrl: h.thumbnailImageUrl,
          heroImageUrl: h.heroImageUrl,
          keywords: h.keywords ?? [],
          categoryIds: [...new Set<string>(cats)],
          ingredientIds: (h.ingredientIds ?? []).map(String),
          sponsorId: h.sponsorId ?? undefined,
        };
      }),
      categoryNames: Object.fromEntries((categories as any[]).map(c => [String(c._id), c.name])),
      ingredientNames: Object.fromEntries((ingredients as any[]).map(i => [String(i._id), i.name])),
    };
    try {
      await this.redisService.set(cacheKey, JSON.stringify(index), 60 * 10);
    } catch {
      // non-critical
    }
    return index;
  }
}
