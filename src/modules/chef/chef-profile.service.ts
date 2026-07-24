import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChefProfile,
  ChefProfileDocument,
} from '../../database/schemas/chef-profile.schema';
import {
  ChefFavourite,
  ChefFavouriteDocument,
} from '../../database/schemas/chef-favourite.schema';
import { User, UserDocument, UserRole } from '../../database/schemas/user.auth.schema';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { RedisService } from '../../redis/redis.service';
import { ChefProfileSyncService } from './chef-profile-sync.service';
import { ChefService } from './chef.service';
import { CreateChefProfileDto } from './dto/create-chef-profile.dto';
import { UpdateChefProfileDto } from './dto/update-chef-profile.dto';
import {
  ALLOWED_CHEF_IMAGE_MIME,
  CHEF_CACHE_KEYS,
  CHEF_UPLOAD_FOLDER,
  slugify,
} from './chef.constants';

@Injectable()
export class ChefProfileService {
  constructor(
    @InjectModel(ChefProfile.name)
    private readonly chefProfileModel: Model<ChefProfileDocument>,
    @InjectModel(ChefFavourite.name)
    private readonly favouriteModel: Model<ChefFavouriteDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly imageUploadService: ImageUploadService,
    private readonly syncService: ChefProfileSyncService,
    private readonly chefService: ChefService,
    private readonly redisService: RedisService,
  ) {}

  private assertValidObjectId(id: string, label = 'id') {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
  }

  private async uploadImageIfPresent(
    file?: Express.Multer.File,
  ): Promise<string | undefined> {
    if (!file) return undefined;
    if (!file.buffer?.length) {
      throw new BadRequestException('Uploaded image is empty');
    }
    if (!ALLOWED_CHEF_IMAGE_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Invalid image type. Allowed: jpeg, png, webp, gif',
      );
    }
    return this.imageUploadService.uploadFile(file, CHEF_UPLOAD_FOLDER);
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const filter: any = { slug };
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };
    const existing = await this.chefProfileModel.findOne(filter).lean().exec();
    if (existing) {
      throw new ConflictException(`Slug "${slug}" is already in use`);
    }
  }

  private async uniquifySlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base) || 'chef';
    let attempt = 0;
    while (true) {
      const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
      const filter: any = { slug: candidate };
      if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };
      const exists = await this.chefProfileModel.exists(filter);
      if (!exists) return candidate;
      attempt += 1;
      if (attempt > 100) {
        return `${slug}-${Date.now()}`;
      }
    }
  }

  async findAllAdmin() {
    return this.chefProfileModel
      .find({})
      .sort({ order: 1, displayNameLower: 1 })
      .populate('cuisineIds', 'title imageUrl')
      .lean()
      .exec();
  }

  async findOneAdmin(id: string) {
    this.assertValidObjectId(id);
    const doc = await this.chefProfileModel
      .findById(id)
      .populate('cuisineIds', 'title imageUrl')
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Chef profile not found');
    return doc;
  }

  async findByUserId(userId: string) {
    this.assertValidObjectId(userId, 'userId');
    const doc = await this.chefProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .populate('cuisineIds', 'title imageUrl')
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Chef profile not found');
    return doc;
  }

  async getOrCreateForUser(userId: string) {
    this.assertValidObjectId(userId, 'userId');
    try {
      return await this.findByUserId(userId);
    } catch {
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user || user.role !== UserRole.CHEF) {
        throw new NotFoundException('Chef profile not found');
      }
      await this.ensureForUser(userId, user.name, user.country);
      return this.findByUserId(userId);
    }
  }

  async ensureForUser(
    userId: string,
    displayName: string,
    country?: string,
  ): Promise<ChefProfileDocument> {
    this.assertValidObjectId(userId, 'userId');
    const existing = await this.chefProfileModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (existing) return existing;

    const slug = await this.uniquifySlug(displayName);
    return this.chefProfileModel.create({
      userId: new Types.ObjectId(userId),
      displayName,
      displayNameLower: displayName.trim().toLowerCase(),
      slug,
      country,
      isPublished: false,
      order: 0,
      lifetime: {
        mealsCooked: 0,
        moneySaved: 0,
        moneyByCurrency: {},
        foodSavedInGrams: 0,
        co2SavedInGrams: 0,
      },
    });
  }

  async create(
    dto: CreateChefProfileDto,
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    this.assertValidObjectId(dto.userId, 'userId');

    const user = await this.userModel.findById(dto.userId).lean().exec();
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CHEF) {
      throw new BadRequestException('User must have CHEF role');
    }

    const existing = await this.chefProfileModel
      .findOne({ userId: new Types.ObjectId(dto.userId) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException('Chef profile already exists for this user');
    }

    const displayName = dto.displayName.trim();
    const slug = dto.slug
      ? slugify(dto.slug)
      : await this.uniquifySlug(displayName);
    if (dto.slug) await this.assertSlugAvailable(slug);

    const avatarImageUrl = await this.uploadImageIfPresent(files?.avatar?.[0]);
    const heroImageUrl = await this.uploadImageIfPresent(files?.hero?.[0]);

    const profile = await this.chefProfileModel.create({
      userId: new Types.ObjectId(dto.userId),
      displayName,
      displayNameLower: displayName.toLowerCase(),
      slug,
      country: dto.country,
      quote: dto.quote,
      bio: dto.bio,
      socialLinks: dto.socialLinks ?? {},
      isPublished: dto.isPublished ?? false,
      order: dto.order ?? 0,
      avatarImageUrl,
      heroImageUrl,
      lifetime: {
        mealsCooked: 0,
        moneySaved: 0,
        moneyByCurrency: {},
        foodSavedInGrams: 0,
        co2SavedInGrams: 0,
      },
    });

    void this.syncService.syncChefs([dto.userId]);
    await this.chefService.invalidateCaches();
    return profile.toObject();
  }

  async update(
    id: string,
    dto: UpdateChefProfileDto,
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    this.assertValidObjectId(id);
    const existing = await this.chefProfileModel.findById(id);
    if (!existing) throw new NotFoundException('Chef profile not found');

    if (dto.displayName !== undefined) {
      existing.displayName = dto.displayName.trim();
      existing.displayNameLower = existing.displayName.toLowerCase();
    }
    if (dto.slug !== undefined) {
      const slug = slugify(dto.slug);
      await this.assertSlugAvailable(slug, id);
      existing.slug = slug;
    }
    if (dto.country !== undefined) existing.country = dto.country;
    if (dto.quote !== undefined) existing.quote = dto.quote;
    if (dto.bio !== undefined) existing.bio = dto.bio;
    if (dto.socialLinks !== undefined) {
      existing.socialLinks = {
        ...(existing.socialLinks || {}),
        ...dto.socialLinks,
      };
    }
    if (dto.isPublished !== undefined) existing.isPublished = dto.isPublished;
    if (dto.order !== undefined) existing.order = dto.order;

    const newAvatar = await this.uploadImageIfPresent(files?.avatar?.[0]);
    if (newAvatar) {
      if (existing.avatarImageUrl) {
        await this.imageUploadService.deleteFile(existing.avatarImageUrl).catch(() => {});
      }
      existing.avatarImageUrl = newAvatar;
    }

    const newHero = await this.uploadImageIfPresent(files?.hero?.[0]);
    if (newHero) {
      if (existing.heroImageUrl) {
        await this.imageUploadService.deleteFile(existing.heroImageUrl).catch(() => {});
      }
      existing.heroImageUrl = newHero;
    }

    await existing.save();
    await this.chefService.invalidateCaches();
    return existing.toObject();
  }

  async updateMe(
    userId: string,
    dto: UpdateChefProfileDto,
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    let profileId: string | null = null;
    const existing = await this.chefProfileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (existing) {
      profileId = String(existing._id);
    } else {
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user || user.role !== UserRole.CHEF) {
        throw new NotFoundException('Chef profile not found');
      }
      const created = await this.ensureForUser(userId, user.name, user.country);
      profileId = String(created._id);
    }
    // Chefs cannot self-publish
    const safeDto = { ...dto };
    delete (safeDto as any).isPublished;
    delete (safeDto as any).order;
    return this.update(profileId, safeDto, files);
  }

  async remove(id: string, hard = false) {
    this.assertValidObjectId(id);
    const existing = await this.chefProfileModel.findById(id);
    if (!existing) throw new NotFoundException('Chef profile not found');

    if (!hard) {
      existing.isPublished = false;
      await existing.save();
      await this.chefService.invalidateCaches();
      return { message: 'Chef unpublished', id };
    }

    if (existing.avatarImageUrl) {
      await this.imageUploadService.deleteFile(existing.avatarImageUrl).catch(() => {});
    }
    if (existing.heroImageUrl) {
      await this.imageUploadService.deleteFile(existing.heroImageUrl).catch(() => {});
    }

    const profileId = String(existing._id);
    const favRows = await this.favouriteModel
      .find({ chefId: existing._id })
      .select({ userId: 1 })
      .lean()
      .exec();
    await this.favouriteModel.deleteMany({ chefId: existing._id });
    await this.chefProfileModel.deleteOne({ _id: existing._id });

    await this.redisService.del(CHEF_CACHE_KEYS.favCount(profileId));
    for (const row of favRows) {
      await this.redisService.sRem(
        CHEF_CACHE_KEYS.favSet(String(row.userId)),
        profileId,
      );
    }

    await this.chefService.invalidateCaches();
    return { message: 'Chef profile deleted', id };
  }

  async recompute(id: string) {
    this.assertValidObjectId(id);
    const profile = await this.chefProfileModel.findById(id).lean().exec();
    if (!profile) throw new NotFoundException('Chef profile not found');
    await this.syncService.syncChefs([profile.userId]);
    return this.findOneAdmin(id);
  }
}
