import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
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
import {
  CommunityGroupMember,
  CommunityGroupMemberDocument,
  GroupMemberRole,
} from 'src/database/schemas/CommunityGroupMember.schema';
import { JoinGroupDto } from './dto/Join-group.Memebr.dto';
import { User, UserDocument } from 'src/database/schemas/user.auth.schema';
import { Type } from 'class-transformer';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import {
  CommunityChallengeParticipant,
  CommunityChallengeParticipantDocument,
} from 'src/database/schemas/challenge.members.schema';
import {
  CommunityChallenge,
  CommunityChallengeDocument,
} from 'src/database/schemas/challenge.schema';
import { JoinChallengeDto } from './dto/join-challenge.to';
import { leveChallengeDto } from './dto/leaveChallenege.dto';
import { ListBucketInventoryConfigurationsCommand } from '@aws-sdk/client-s3';

@Injectable()
export class CommunityGroupsService {
  private readonly logger = new Logger(CommunityGroupsService.name);
  private readonly SINGLE_COMMUNITY_CACHE_KEY = 'community:group';

  constructor(
    @InjectModel(CommunityGroups.name)
    private readonly CommunityModel: Model<CommunityGroupDocument>,
    @InjectModel(CommunityGroupMember.name)
    private readonly communityGroupMemberModel: Model<CommunityGroupMemberDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(CommunityChallenge.name)
    private readonly communityChallengeModel: Model<CommunityChallengeDocument>,
    @InjectModel(CommunityChallengeParticipant.name)
    private readonly communityChallengeParticipantModel: Model<CommunityChallengeParticipantDocument>,
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
    console.log(file);
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invliad User');
    let profileImageUrl = '';
    if (file?.profileImage?.[0]) {
      profileImageUrl = await this.imageuploadService.uploadFile(
        file.profileImage[0],
        'saveful/communityGroup',
      );
    }

    console.log(profileImageUrl);

    // ** need to invalid cache
    const cachedKey = `community:Groups:${userId}`;

    // ** code verification part
    let code = '';
    let attempts = 0;
    while (attempts < 10) {
      code = generateJoinCode();
      const redisHealthy = await this.redisService.isHealthy();
      if (redisHealthy) {
        const existsInRedis = await this.redisService.isJoinCodeUsed(code);
        if (existsInRedis) {
          attempts++;
          continue;
        }
      } else {
        const existsInDatabase = await this.CommunityModel.exists({
          joinCode: code,
        });
        if (existsInDatabase) {
          attempts++;
          continue;
        }
      }

      break;
    }
    this.logger.log('attempts required', attempts);

    const group = await this.CommunityModel.create({
      name: createCommunityGroupDto.name,
      description: createCommunityGroupDto.description,
      profilePhotoUrl: profileImageUrl,
      joinCode: code,
      ownerId: userId,
      memberCount: 1,
    });

    // ** create a gruop member for this also who created group [ the fist member]
    await this.communityGroupMemberModel.create({
      userId: new Types.ObjectId(userId),
      groupId: group._id,
      isActive: true,
      role: GroupMemberRole.OWNER,
    });

    if (await this.redisService.isHealthy()) {
      await this.redisService.releaseJoinCode(code);
      await this.redisService.del(cachedKey);
    }
    console.log(group);
    console.log('code', code);
    return group;
  }

  async findAllCommunityGroupByUserId(userId: string) {
    const cachedKey = `community:Groups:${userId}`;
    const cachedData = await this.redisService.get(cachedKey);
    console.log('CachedData', cachedData);
    if (cachedData) return cachedData;
    const result = await this.CommunityModel.find({ ownerId: userId });
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }

  async joinGroupByCode(dto: JoinGroupDto, userId: string) {
    const group = await this.CommunityModel.findOne({
      joinCode: dto.code, 
      isDeleted: false,
    });
    if (!group) {
      throw new NotFoundException('Invalid join code');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid User');
    }
    const user = await this.userModel.findById(new Types.ObjectId(userId));
    if (!user) throw new BadRequestException();
    this.logger.log(
      'an invalid user with an invalid userId just hit the endpoint',
      userId,
    );

    // ** check if the user exists in the group or not
    const existing = await this.communityGroupMemberModel.findOne({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
    });
    if (existing) {
      if (existing.isActive) {
        throw new BadRequestException('Already a member');
      }

      existing.isActive = true;
      existing.joinedViaCode = dto.code;
      existing.reJoined = true;
      await existing?.save();
      // ** update the member count in the group;
      await this.CommunityModel.updateOne(
        { _id: group._id },
        { $inc: { memberCount: 1 } },
      );
      return { message: 'joined sucessfully' };
    }
    // ** rejoin if u are not a active member and want to rejoin again

    try {
      await this.communityGroupMemberModel.create({
        groupId: group._id,
        userId: new Types.ObjectId(userId),
        joinedViaCode: dto.code,
      });
      await this.CommunityModel.updateOne(
        { _id: group._id },
        { $inc: { memberCount: 1 } },
      );

      return { message: 'Joined this group sucessfully' };
    } catch (error) {
      if (error.code === 11000) {
        throw new BadRequestException('already a memeber');
      }
      throw error;
    }
  }

  async findOne(groupId: string) {
    if (!Types.ObjectId.isValid(groupId))
      throw new BadRequestException('Invalid Group');

    // ** caching phase
    const cachedKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${groupId.toString()}`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return cachedData;

    const group = await this.CommunityModel.findOne({
      _id: new Types.ObjectId(groupId),
      isDeleted: false,
    }).populate('ownerId', 'name email');
    if (!group) throw new NotFoundException('Community not found');

    const members = await this.communityGroupMemberModel
      .find({ groupId: group._id, isActive: true })
      .populate('userId', 'name')
      .select('userId role joinedAt');
    const response = {
      group,
      members,
    };
    await this.redisService.set(cachedKey, JSON.stringify(response), 60 * 20);
    return response;
  }

  async update(
    dto: UpdateCommunityGroupDto,
    userId: string,
    file: { groupProfileImage: Express.Multer.File[] },
  ) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid user');
    const group = await this.CommunityModel.findById(
      new Types.ObjectId(dto.groupId),
    );
    if (!group || group.isDeleted === true)
      throw new NotFoundException('community Not found');
    const groupMemebr = await this.communityGroupMemberModel.findOne({
      groupId: group._id,
      userId: new Types.ObjectId(userId),
      isActive: true,
      role: GroupMemberRole.OWNER,
    });
    if (!groupMemebr) throw new ForbiddenException('only owner can edit');
    if (dto.name) group.name = dto.name;
    if (dto.description) group.description = dto.description;
    let imageUrl = '';
    if (file?.groupProfileImage?.[0]) {
      imageUrl = await this.imageuploadService.uploadFile(
        file.groupProfileImage[0],
        'saveful/communityGroup',
      );
      group.profilePhotoUrl = imageUrl;
    }
    await group.save();
    const cacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${group._id.toString()}`;
    await this.redisService.del(cacheKey);
    return group;
  }

  async remove(groupId: string, userId: string) {
    const existingGroup = await this.CommunityModel.findById(
      new Types.ObjectId(groupId),
    );
    if (!existingGroup || existingGroup.isDeleted === true) {
      throw new NotFoundException('Community not found');
    }
    const isAuthorizedMemeber = await this.communityGroupMemberModel.findOne({
      groupId: existingGroup._id,
      userId: new Types.ObjectId(userId),
      isActive: true,
      role: GroupMemberRole.OWNER,
    });
    if (!isAuthorizedMemeber)
      throw new ForbiddenException('Only owner can Perform this Operation');
    existingGroup.isDeleted = true;
    await existingGroup.save();
    const cacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${existingGroup._id.toString()}`;
    await this.redisService.del(cacheKey);
    return {
      message: 'Group deleted sucessfully',
    };
  }

  async createChallenge(userId: string, dto: CreateChallengeDto) {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(dto.communityId)
    )
      throw new BadRequestException();
    const authorizedUser = await this.communityGroupMemberModel.findOne({
      groupId: dto.communityId,
      userId,
      isActive: true,
      role: GroupMemberRole.OWNER,
    });
    if (!authorizedUser)
      throw new ForbiddenException('only owners can create the challange');
    const community = await this.CommunityModel.findById(
      new Types.ObjectId(dto.communityId),
    );
    if (!community) throw new NotFoundException();
    const result = await this.communityChallengeModel.create({
      communityId: new Types.ObjectId(dto.communityId),
      createdBy: new Types.ObjectId(userId),
      challengeName: dto.challengeName,
      description: dto.description,
      startDate: dto.startDate,
      endDate: dto.endDate,
      challengeGoal: dto.challengeGoals,
    });
    const cachedKey = `community:challenges:communityId:${dto.communityId}`;
    await this.redisService.del(cachedKey);
    return result;
  }

  async getChallangesByCommunityId(communityId: string) {
    if (!Types.ObjectId.isValid(communityId)) throw new BadRequestException();
    const cachedKey = `community:challenges:communityId:${communityId}`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return cachedData;
    const community = await this.CommunityModel.findById(
      new Types.ObjectId(communityId),
    );
    const result = await this.communityChallengeModel.find({
      communityId: new Types.ObjectId(communityId),
    });
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 30);
    return result;
  }

  async getChallengeById(challengeId: string) {
    const cachedKey = `community:challenge:single:${challengeId}`;
    const cachedData = await this.redisService.get(cachedKey);
    if (cachedData) return cachedData;
    const result = await this.communityChallengeModel.findById(
      new Types.ObjectId(challengeId),
    );
    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 20);
    return result;
  }


  async getUserGroups(userId: string) {
  const objectUserId = new Types.ObjectId(userId);

  return this.communityGroupMemberModel.aggregate([
    {
      $match: {
        userId: objectUserId,
        isActive: true,
      },
    },
    {
      $lookup: {
        from: 'communitygroups', 
        localField: 'groupId',
        foreignField: '_id',
        as: 'group',
      },
    },
    {
      $unwind: '$group',
    },
    {
      $match: {
        'group.isDeleted': false,
      },
    },
    {
      $project: {
        _id: 0,
        role: 1,
        joinedViaCode: 1,
        group: {
          _id: 1,
          name: 1,
          description: 1,
          profilePhotoUrl: 1,
          memberCount: 1,
          totalFoodSaved: 1,
          ownerId: 1,
        },
      },
    },
  ]);
}

  /**
   * 1.validate if the user is the part of the community or not
   * 2.create a participate for the challenge
   * 3.increment member count in the challenge model
   * 4.update saved food one
   * */

  async joinChallenge(userId: string, dto: JoinChallengeDto) {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(dto.communityId)
    )
      throw new BadRequestException();
    const isUserCommunityMember = await this.communityGroupMemberModel.findOne({
      groupId: new Types.ObjectId(dto.communityId),
      userId: userId,
      isActive: true,
    });
    if (!isUserCommunityMember)
      throw new ForbiddenException('you need to join the community first');
    const result = await this.communityChallengeParticipantModel.create({
      userId: new Types.ObjectId(userId),
      communityId: new Types.ObjectId(dto.communityId),
      challengeId: new Types.ObjectId(dto.challnageId),
    });
    if (result) {
      await this.communityChallengeModel.findByIdAndUpdate(
        new Types.ObjectId(dto.challnageId),
        { $inc: { memberCount: 1 } },
      );
    }
    return {
      message: 'challenge join sucessfully',
      result,
    };
  }

  async leaveChallenge(dto: leveChallengeDto, userId: string) {
    // ** check if the ids are valid or not
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(dto.communityId) ||
      !Types.ObjectId.isValid(dto.challengeId)
    ) {
      throw new BadRequestException();
    }
    const isCommunityUser = await this.communityGroupMemberModel.findOne({
      groupId: new Types.ObjectId(dto.communityId),
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
    if (!isCommunityUser)
      throw new ForbiddenException(
        'You need to join the community to leave this challange',
      );
    const participant =
      await this.communityChallengeParticipantModel.findOneAndUpdate(
        {
          communityId: new Types.ObjectId(dto.communityId),
          userId: new Types.ObjectId(userId),
          isActive: true,
        },
        { isActive: false },
      );
    if (!participant) {
      throw new BadRequestException('you are not the part of this challenge');
    }

    await this.communityChallengeModel.updateOne(
      { id: dto.challengeId },
      { $inc: { memberCount: -1 } },
    );

    return {
      message: 'leaved challenge sucessfully',
      status: true,
    };
  }

  async transferOwnership(
    userId: string,
    groupId: string,
    newOwnerEmail: string,
  ) {
    const user = await this.userModel.findById(new Types.ObjectId(userId));
    if (!user) throw new BadRequestException();
  }
}
