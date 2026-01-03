import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StickerDocument, Stickers } from 'src/database/schemas/stcikers.schema';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { RedisService } from 'src/redis/redis.service';


@Injectable()
export class StickerService {
    constructor(@InjectModel(Stickers.name) private readonly stickerMode:Model<StickerDocument>,
    private readonly imageUploadService:ImageUploadService,
    private readonly redisService:RedisService

){}4


    async create(dto:CreateStickerDto,file:{image:Express.Multer.File[]}){
         const existing = await this.stickerMode.findOne({title:dto.title})
         if(existing) throw new ConflictException("Sticker with this name already exists")
         let imageUrl = ''
         if(file?.image?.[0]){
            imageUrl = await this.imageUploadService.uploadFile(file.image[0],'saveful/sticker')
         }
         const cachedKey = `sticker:all`
         const result = await this.stickerMode.create({
            title:dto.title,
            description:dto.description,
            imageUrl:imageUrl
         })
         await this.redisService.del(cachedKey);
         return result
    }


    async fetchAllStickers(){
        const cachedKey = `sticker:all`
        const cachedData = await this.redisService.get(cachedKey)
        if(cachedData) return JSON.parse(cachedData)
        const result = await this.stickerMode.find()
        await this.redisService.set(cachedKey,JSON.stringify(result),60 * 20)
        return result
    }
}
