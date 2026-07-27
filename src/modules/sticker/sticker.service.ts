import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StickerDocument, Stickers } from 'src/database/schemas/stcikers.schema';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { RedisService } from 'src/redis/redis.service';
import { DataVersionService } from '../data-version/data-version.service';


@Injectable()
export class StickerService {
    constructor(@InjectModel(Stickers.name) private readonly stickerMode:Model<StickerDocument>,
    private readonly imageUploadService:ImageUploadService,
    private readonly redisService:RedisService,
    @Optional() private readonly dataVersion?: DataVersionService,

){}4

    /**
     * Sticker images are embedded in the recipe summary payload, so a sticker
     * change also invalidates every cached recipe summary.
     */
    private async invalidateStickerCaches() {
        try {
            await this.redisService.delByPattern('recipes:summaries:v2*');
        } catch { /* non-critical */ }
        await this.dataVersion?.bump('stickers');
        await this.dataVersion?.bump('recipes');
    }


    async create(dto:CreateStickerDto,file:{image:Express.Multer.File[]}){
         const existing = await this.stickerMode.findOne({title:dto.title})
         if(existing) throw new ConflictException("Sticker with this name already exists")
         let imageUrl = ''
         if(file?.image?.[0]){
            imageUrl = await this.imageUploadService.uploadFile(file.image[0],'saveful/sticker')
         }
         const cachedKey = `sticker:all`
         const stickerData: any = {
            title: dto.title,
            imageUrl: imageUrl
         };
         if (dto.description) {
            stickerData.description = dto.description;
         }
         const result = await this.stickerMode.create(stickerData)
         try { await this.redisService.del(cachedKey); } catch { /* non-critical */ }
         await this.invalidateStickerCaches();
         return result
    }


    async fetchAllStickers(){
        const cachedKey = `sticker:all`
        try {
            const cachedData = await this.redisService.get(cachedKey)
            if(cachedData) return JSON.parse(cachedData)
        } catch { /* corrupted cache or Redis down */ }
        const result = await this.stickerMode.find()
        try { await this.redisService.set(cachedKey,JSON.stringify(result),60 * 20) } catch { /* non-critical */ }
        return result
    }

    async update(id: string, dto: CreateStickerDto, file?: { image: Express.Multer.File[] }) {
        const existing = await this.stickerMode.findById(id);
        if (!existing) throw new BadRequestException('Sticker not found');

        const updateData: any = {
            title: dto.title
        };

        if (dto.description !== undefined) {
            updateData.description = dto.description;
        }

        if (file?.image?.[0]) {
            const imageUrl = await this.imageUploadService.uploadFile(file.image[0], 'saveful/sticker');
            updateData.imageUrl = imageUrl;
        }

        const cachedKey = `sticker:all`;
        const result = await this.stickerMode.findByIdAndUpdate(id, updateData, { new: true });
        try { await this.redisService.del(cachedKey); } catch { /* non-critical */ }
        await this.invalidateStickerCaches();
        return result;
    }

    async delete(id: string) {
        const existing = await this.stickerMode.findById(id);
        if (!existing) throw new BadRequestException('Sticker not found');

        const cachedKey = `sticker:all`;
        await this.stickerMode.findByIdAndDelete(id);
        try { await this.redisService.del(cachedKey); } catch { /* non-critical */ }
        await this.invalidateStickerCaches();
        return { message: 'Sticker deleted successfully' };
    }
}
