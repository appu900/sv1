import { BadRequestException, Injectable } from '@nestjs/common';
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
    files: { image: Express.Multer.File[] },
  ) {
    let imageUrl = '';
    if (files?.image?.[0]) {
      imageUrl = await this.imageUploadService.uploadFile(
        files.image[0],
        'saveful/hack-category',
      );
    }
    const result = await this.hacksCategory.create({
      name: dto.name,
      imageUrl: imageUrl,
    });
    const cacheKey = `hacks:category:all`
    await this.redisService.del(cacheKey)
    return {
      message: 'hacks categort created successfully',
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
      .lean();
    const response = {
      category: {
        id: hackCategory._id,
        name: hackCategory.name,
        imageUrl: hackCategory.imageUrl,
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
    files?: { image: Express.Multer.File[] },
  ) {
    if (!Types.ObjectId.isValid(dto.categoryId)) {
      throw new BadRequestException('Invalid Category Id');
    }
    const category = await this.hacksCategory.findById(dto.categoryId);
    if (!category) {
      throw new BadRequestException('category does not exists');
    }
    let imageUrl: string | undefined;
    if (files?.image?.[0]) {
      imageUrl = await this.imageUploadService.uploadFile(
        files.image[0],
        'saveful/hacks',
      );
    }

    const hack = await this.hackModel.create({
        title:dto.title,
        description:dto.description,
        categoryId:category._id,
        imageUrl:imageUrl,
        youtubeLink:dto.youtubeLink
    })
    const cachedKey = `hacks:single:${hack._id}`
    await this.redisService.set(cachedKey,JSON.stringify(hack),60 * 20)
    await this.redisService.del(`hacks:category:${dto.categoryId}`)
    return {
        message:"hack created sucessfully",
        hackId:hack._id
    }
  }

  async getHackById(hackId:string){
    if(!Types.ObjectId.isValid(hackId)) throw new BadRequestException("Invalid hack id")
    const cacheKey = `hacks:single:${hackId}`
    const cached = await this.redisService.get(cacheKey)
    if(cached) return cached
    const hack = await this.hackModel.findById(hackId)
    if(!hack) throw new BadRequestException("Hack not found")
    await this.redisService.set(cacheKey,JSON.stringify(hack),60*10)
    return hack
  }
}
