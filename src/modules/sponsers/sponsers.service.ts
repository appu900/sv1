import { Injectable } from '@nestjs/common';
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
    await this.redisService.del(cachedKey);
    return result;
  }

  async fetchAll() {
    const cachedKey = `sponsers:all`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return JSON.parse(cachedData);
    const result = await this.sponsersModel.find();
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }
}
