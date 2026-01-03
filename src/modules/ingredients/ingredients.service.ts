import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IngredientsCategory,
  IngredientsCategoryDocument,
} from 'src/database/schemas/ingredinats.Category.schema';
import { RedisService } from 'src/redis/redis.service';
import { CreateCatgoryDto } from './dto/ingrediants.category.dto';
import { ImageUploadService } from '../image-upload/image-upload.service';

@Injectable()
export class IngredientsService {
  private readonly logger = new Logger(IngredientsService.name);
  constructor(
    @InjectModel(IngredientsCategory.name)
    private readonly ingredinatsCategory: Model<IngredientsCategoryDocument>,
    private readonly redisService:RedisService,
    private readonly imageuploadService:ImageUploadService
  ) {}

  async create(dto:CreateCatgoryDto,files:{image:Express.Multer.File[]}){
     const existing = await this.ingredinatsCategory.findOne({name:dto.name})
     console.log(existing)
     if(existing) throw new ConflictException("this categiry already exists")
     let imageUrl = ''
     if(files?.image?.[0]){
         imageUrl = await this.imageuploadService.uploadFile(files.image[0],'saveful/ingredinats-category') 
     }
     const cachedKey = `Ingrediants:Category:all`
     const result = await this.ingredinatsCategory.create({
        name:dto.name,
        imageUrl:imageUrl,
        description:dto.description
    })
    await this.redisService.del(cachedKey)
    return result
  }


  async getAllCategories(){
    const cachedKey = `Ingrediants:Category:all`
    const cachedData = await this.redisService.get(cachedKey)
    if(cachedData) return JSON.parse(cachedData)
    const result = await this.ingredinatsCategory.find()
    await this.redisService.set(cachedKey,JSON.stringify(result),60 * 20)
    return result
  }
}
