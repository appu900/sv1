import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Sponsers,
  SponsersDocument,
} from 'src/database/schemas/sponsers.schema';
import { RedisService } from 'src/redis/redis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { CreateSponsers } from './dto/Create.sponsers.dto';

@Injectable()
export class SponsersService {
  constructor(
    @InjectModel(Sponsers.name)
    private readonly sponsersModel: Model<SponsersDocument>,
    private readonly redisService: RedisService,
    private readonly imageUplaodService: ImageUploadService,
  ) {}

  async create(
    dto: CreateSponsers,
    files: {
      logo: Express.Multer.File[];
      logoBlackAndWhite: Express.Multer.File[];
    },
  ) {
    let logourl = '';
    let blackAndWhiteLogoUrl = '';
    if (files?.logo?.[0] && files?.logoBlackAndWhite?.[0]) {
      logourl = await this.imageUplaodService.uploadFile(
        files?.logo?.[0],
        'saveful/sponsers',
      );
      blackAndWhiteLogoUrl = await this.imageUplaodService.uploadFile(
        files?.logoBlackAndWhite?.[0],
        'saveful/sponsers',
      );
    }
    const result = await this.sponsersModel.create({
      title: dto.title,
      logo: logourl,
      logoBlackAndWhite: blackAndWhiteLogoUrl,
      broughtToYouBy: dto.broughtToYouBy,
      tagline: dto.tagline,
    });
    const cachedKey = `sponsers:all`;
    try {
      await this.redisService.del(cachedKey);
    } catch (e) {
      // non-critical — cache will expire naturally
    }
    return result;
  }

  async fetchAll() {
    const cachedKey = `sponsers:all`;
    try {
      const cachedData = await this.redisService.get(cachedKey);
      if (cachedData) return JSON.parse(cachedData);
    } catch {
      // corrupted cache or Redis down — fall through to DB
    }
    const result = await this.sponsersModel.find();
    try {
      await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    } catch {
      // non-critical
    }
    return result;
  }

  async fetchById(id: string) {
    const cachedKey = `sponsers:single:${id}`;
    try {
      const cachedData = await this.redisService.get(cachedKey);
      if (cachedData) return JSON.parse(cachedData);
    } catch {
      // corrupted cache or Redis down — fall through to DB
    }
    const result = await this.sponsersModel.findById(id);
    if (!result) throw new NotFoundException('Sponsor not found');
    try {
      await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    } catch {
      // non-critical
    }
    return result;
  }

  async update(
    id: string,
    dto: Partial<CreateSponsers>,
    files?: {
      logo?: Express.Multer.File[];
      logoBlackAndWhite?: Express.Multer.File[];
    },
  ) {
    const existing = await this.sponsersModel.findById(id);
    if (!existing) throw new NotFoundException('Sponsor not found');

    let logoUrl = existing.logo;
    let logoBWUrl = existing.logoBlackAndWhite;

    if (files?.logo?.[0]) {
      logoUrl = await this.imageUplaodService.uploadFile(
        files.logo[0],
        'saveful/sponsers',
      );
    }

    if (files?.logoBlackAndWhite?.[0]) {
      logoBWUrl = await this.imageUplaodService.uploadFile(
        files.logoBlackAndWhite[0],
        'saveful/sponsers',
      );
    }

    const updatePayload: Partial<Sponsers> = {
      title: dto.title ?? existing.title,
      broughtToYouBy: dto.broughtToYouBy ?? existing.broughtToYouBy,
      tagline: dto.tagline ?? existing.tagline,
      logo: logoUrl,
      logoBlackAndWhite: logoBWUrl,
    };

    const updated = await this.sponsersModel.findByIdAndUpdate(id, updatePayload, {
      new: true,
    });

    const allKey = `sponsers:all`;
    const singleKey = `sponsers:single:${id}`;
    try {
      await this.redisService.del(allKey);
      await this.redisService.del(singleKey);
    } catch {
      // non-critical
    }
    return updated;
  }

  async remove(id: string) {
    const deleted = await this.sponsersModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Sponsor not found');
    const allKey = `sponsers:all`;
    const singleKey = `sponsers:single:${id}`;
    try {
      await this.redisService.del(allKey);
      await this.redisService.del(singleKey);
    } catch {
      // non-critical
    }
    return { success: true };
  }
}
