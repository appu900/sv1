import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FoodFact, FoodFactDocument } from 'src/database/schemas/food-fact.schema';
import { RedisService } from 'src/redis/redis.service';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { CreateFoodFactDto } from './dto/create-food-fact.dto';
import { UpdateFoodFactDto } from './dto/update-food-fact.dto';

@Injectable()
export class FoodFactService {
  constructor(
    @InjectModel(FoodFact.name)
    private readonly foodFactModel: Model<FoodFactDocument>,
    private readonly redisService: RedisService,
    private readonly imageUploadService: ImageUploadService,
  ) {}

  async create(
    dto: CreateFoodFactDto,
  ) {
    const foodFactData: any = {
      title: dto.title,
      factOrInsight: dto.factOrInsight,
    };

    if (dto.sponsor) {
      foodFactData.sponsor = new Types.ObjectId(dto.sponsor);
    }

    if (dto.relatedIngredient) {
      foodFactData.relatedIngredient = new Types.ObjectId(dto.relatedIngredient);
    }

    const result = await this.foodFactModel.create(foodFactData);
    const cachedKey = `food-facts:all`;
    await this.redisService.del(cachedKey);
    return result;
  }

  async fetchAll() {
    const cachedKey = `food-facts:all`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return JSON.parse(cachedData);

    const result = await this.foodFactModel
      .find()
      .populate('sponsor', 'title logo')
      .populate('relatedIngredient', 'name');
    
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }

  async fetchById(id: string) {
    const cachedKey = `food-facts:single:${id}`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return JSON.parse(cachedData);

    const result = await this.foodFactModel
      .findById(id)
      .populate('sponsor', 'title logo')
      .populate('relatedIngredient', 'name');
    
    if (!result) {
      throw new NotFoundException('Food fact not found');
    }

    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }

  async update(
    id: string,
    dto: UpdateFoodFactDto,
  ) {
    const foodFact = await this.foodFactModel.findById(id);
    if (!foodFact) {
      throw new NotFoundException('Food fact not found');
    }

    const updateData: any = {};

    if (dto.title) updateData.title = dto.title;
    if (dto.factOrInsight !== undefined) updateData.factOrInsight = dto.factOrInsight;
    if (dto.sponsor) updateData.sponsor = new Types.ObjectId(dto.sponsor);
    if (dto.relatedIngredient) updateData.relatedIngredient = new Types.ObjectId(dto.relatedIngredient);

    const result = await this.foodFactModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true },
    )
      .populate('sponsor', 'title logo')
      .populate('relatedIngredient', 'name');

    const cachedKeyAll = `food-facts:all`;
    const cachedKeySingle = `food-facts:single:${id}`;
    await this.redisService.del(cachedKeyAll);
    await this.redisService.del(cachedKeySingle);

    return result;
  }

  async delete(id: string) {
    const result = await this.foodFactModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Food fact not found');
    }

    const cachedKeyAll = `food-facts:all`;
    const cachedKeySingle = `food-facts:single:${id}`;
    await this.redisService.del(cachedKeyAll);
    await this.redisService.del(cachedKeySingle);

    return { message: 'Food fact deleted successfully', deletedId: id };
  }
}
