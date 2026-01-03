import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DietCategory,
  DietCategoryDocument,
} from 'src/database/schemas/diet.schema';
import { RedisService } from 'src/redis/redis.service';
import { CreateDietDto } from './dto/create.diet.dto';

@Injectable()
export class DietService {
  constructor(
    @InjectModel(DietCategory.name)
    private readonly dietCategoryModel: Model<DietCategoryDocument>,
    private readonly redisService: RedisService,
  ) {}

  async create(dto: CreateDietDto) {
    const cachedKey = `diets:all`;
    if (dto.diets.length == 0)
      throw new BadRequestException('Need some inputes');
    await Promise.all(
      dto.diets.map((diet) =>
        this.dietCategoryModel.create({ name: diet.trim() }),
      ),
    );
    await this.redisService.del(cachedKey);
  }


  async getAll(){
       const cachedKey = `diets:all`;
       const cachedData = await this.redisService.get(cachedKey)
       if(cachedData) return JSON.parse(cachedData)
       const res = await this.dietCategoryModel.find()
       await this.redisService.set(cachedKey,JSON.stringify(res),60 * 20)
       return res
  }
}
