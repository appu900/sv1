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
    const results = await Promise.all(
      dto.diets.map((diet) =>
        this.dietCategoryModel.create({ name: diet.trim() }),
      ),
    );
    await this.redisService.del(cachedKey);
    return results;
  }


  async getAll(){
       const cachedKey = `diets:all`;
       const cachedData = await this.redisService.get(cachedKey)
       if(cachedData) return JSON.parse(cachedData)
       const res = await this.dietCategoryModel.find()
       await this.redisService.set(cachedKey,JSON.stringify(res),60 * 20)
       return res
  }

  async update(id: string, dto: { name: string }) {
    const existing = await this.dietCategoryModel.findById(id);
    if (!existing) throw new BadRequestException('Diet category not found');

    const cachedKey = `diets:all`;
    const result = await this.dietCategoryModel.findByIdAndUpdate(
      id,
      { name: dto.name },
      { new: true }
    );
    await this.redisService.del(cachedKey);
    return result;
  }

  async delete(id: string) {
    const existing = await this.dietCategoryModel.findById(id);
    if (!existing) throw new BadRequestException('Diet category not found');

    const cachedKey = `diets:all`;
    await this.dietCategoryModel.findByIdAndDelete(id);
    await this.redisService.del(cachedKey);
    return { message: 'Diet category deleted successfully' };
  }
}
