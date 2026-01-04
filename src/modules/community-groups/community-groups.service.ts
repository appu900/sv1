import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CreateCommunityGroupDto } from './dto/create-community-group.dto';
import { UpdateCommunityGroupDto } from './dto/update-community-group.dto';
import { InjectModel } from '@nestjs/mongoose';
import {
  CommunityGroupDocument,
  CommunityGroups,
} from 'src/database/schemas/community.groups.schema';
import { Model, Types } from 'mongoose';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { RedisService } from 'src/redis/redis.service';
import { generateJoinCode } from 'src/utils/generatecode.utils';


@Injectable()
export class CommunityGroupsService {
  private readonly logger = new Logger(CommunityGroupsService.name);
  constructor(
    @InjectModel(CommunityGroups.name)
    private readonly CommunityModel: Model<CommunityGroupDocument>,
    private readonly imageuploadService: ImageUploadService,
    private readonly redisService: RedisService,
  ) {}

  async syncJoinCodesToRedis() {
    const codes = await this.CommunityModel.find({ isDeleted: false })
      .select('joinCode')
      .lean();
    if (codes.length > 0) {
      await this.redisService.resetJoinCodes();
      await this.redisService.addJoinCodes(codes.map((c) => c.joinCode));
    }
  }

 
  async create(
    createCommunityGroupDto: CreateCommunityGroupDto,
    userId: string,
    file: { profileImage: Express.Multer.File[] },
  ) {
    console.log(file)
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invliad User');
    let profileImageUrl = '';
    if (file?.profileImage?.[0]) {
      profileImageUrl = await this.imageuploadService.uploadFile(
        file.profileImage[0],
        'saveful/communityGroup',
      );
    }

    console.log(profileImageUrl)


    // ** need to invalid cache 
    const cachedKey = `community:Groups:${userId}`;


    // ** code verification part 
    let code = ''
    let attempts = 0
    while(attempts < 10){
      code = generateJoinCode()
      const redisHealthy = await this.redisService.isHealthy();
      if(redisHealthy){
        const existsInRedis = await this.redisService.isJoinCodeUsed(code)
        if(existsInRedis){
          attempts++;
          continue;
        }
      }else{
        const existsInDatabase = await this.CommunityModel.exists({joinCode:code})
        if(existsInDatabase){
          attempts++;
          continue;
        }
      }

      break
    }
    this.logger.log("attempts required",attempts)

    const group = await this.CommunityModel.create({
      name:createCommunityGroupDto.name,
      description:createCommunityGroupDto.description,
      profilePhotoUrl:profileImageUrl,
      joinCode:code,
      ownerId:userId,
      memberCount:1
    })
    

    if(await this.redisService.isHealthy()){
       await this.redisService.releaseJoinCode(code)
       await this.redisService.del(cachedKey)
    }
    console.log(group)
    console.log("code",code)
    return group
  }

  async findAllCommunityGroupByUserId(userId: string) {
    const cachedKey = `community:Groups:${userId}`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return JSON.parse(cachedData);
    const result = await this.CommunityModel.find({ ownerId: userId });
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }

  findOne(id: number) {
    return `This action returns a #${id} communityGroup`;
  }

  update(id: number, updateCommunityGroupDto: UpdateCommunityGroupDto) {
    return `This action updates a #${id} communityGroup`;
  }

  remove(id: number) {
    return `This action removes a #${id} communityGroup`;
  }
}
