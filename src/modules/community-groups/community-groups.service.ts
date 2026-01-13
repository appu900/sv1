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
import { UpdateChallengeDto } from './dto/update-challenge.dto';
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
    const result = await this.CommunityModel.find({ 
      ownerId: userId,
      isDeleted: false 
    });
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

      // Clear caches when user rejoins
      const groupCacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${group._id.toString()}`;
      const userGroupsKey = `community:Groups:${userId}`;
      await this.redisService.del(groupCacheKey);
      await this.redisService.del(userGroupsKey);

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

      // Clear caches when new member joins
      const groupCacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${group._id.toString()}`;
      const userGroupsKey = `community:Groups:${userId}`;
      await this.redisService.del(groupCacheKey);
      await this.redisService.del(userGroupsKey);

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
    
    const allMembers = await this.communityGroupMemberModel.find({
      groupId: existingGroup._id,
      isActive: true,
    }).select('userId');

    existingGroup.isDeleted = true;
    await existingGroup.save();

    await this.communityGroupMemberModel.updateMany(
      { groupId: existingGroup._id, isActive: true },
      { isActive: false },
    );

    // Soft delete all challenges in this group
    await this.communityChallengeModel.updateMany(
      { communityId: existingGroup._id, isDeleted: false },
      { isDeleted: true },
    );

    // Deactivate all challenge participants
    await this.communityChallengeParticipantModel.updateMany(
      { communityId: existingGroup._id, isActive: true },
      { isActive: false },
    );

    // Clear all related caches
    const cacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${existingGroup._id.toString()}`;
    const challengesCacheKey = `community:challenges:communityId:${existingGroup._id.toString()}`;
    const membersCacheKey = `community:members:${existingGroup._id.toString()}`;
    await this.redisService.del(cacheKey);
    await this.redisService.del(challengesCacheKey);
    await this.redisService.del(membersCacheKey);

    // Clear cache for ALL members (including owner)
    for (const member of allMembers) {
      const userGroupsKey = `community:Groups:${member.userId.toString()}`;
      await this.redisService.del(userGroupsKey);
    }
    
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
      groupId: new Types.ObjectId(dto.communityId),
      userId: new Types.ObjectId(userId),
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
    
    const challenges = await this.communityChallengeModel.find({
      communityId: new Types.ObjectId(communityId),
      isDeleted: false,
    }).lean({ virtuals: true });

    const now = new Date();
    const categorized = {
      active: challenges.filter(c => c.status && new Date(c.startDate) <= now && new Date(c.endDate) >= now),
      upcoming: challenges.filter(c => c.status && new Date(c.startDate) > now),
      closed: challenges.filter(c => c.status && new Date(c.endDate) < now),
      cancelled: challenges.filter(c => !c.status),
    };

    const result = {
      challenges,
      categorized,
    };

    await this.redisService.set(cachedKey, JSON.stringify(result), 60 * 30);
    return result;
  }

  async getChallengeById(challengeId: string, userId?: string) {
    if (!Types.ObjectId.isValid(challengeId)) throw new BadRequestException();
    
    const result = await this.communityChallengeModel
      .findById(new Types.ObjectId(challengeId))
      .lean({ virtuals: true });
    
    if (!result) throw new NotFoundException('Challenge not found');

    // Check if user is a participant
    let isParticipant = false;
    if (userId && Types.ObjectId.isValid(userId)) {
      const participant = await this.communityChallengeParticipantModel.findOne({
        userId: new Types.ObjectId(userId),
        challengeId: new Types.ObjectId(challengeId),
        isActive: true,
      });
      isParticipant = !!participant;
    }

    return {
      ...result,
      isParticipant,
    };
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
      userId: new Types.ObjectId(userId),
      isActive: true,
    });
    if (!isUserCommunityMember)
      throw new ForbiddenException('you need to join the community first');
    
    // Check if already a participant
    const existingParticipant = await this.communityChallengeParticipantModel.findOne({
      userId: new Types.ObjectId(userId),
      challengeId: new Types.ObjectId(dto.challnageId),
    });

    if (existingParticipant) {
      if (existingParticipant.isActive) {
        throw new BadRequestException('Already a participant in this challenge');
      }
      // Reactivate if previously left
      existingParticipant.isActive = true;
      await existingParticipant.save();
      await this.communityChallengeModel.findByIdAndUpdate(
        new Types.ObjectId(dto.challnageId),
        { $inc: { memberCount: 1 } },
      );
      return {
        message: 'Rejoined challenge successfully',
        result: existingParticipant,
      };
    }

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

    // Clear cache
    const cacheKey = `community:challenge:single:${dto.challnageId}`;
    const listCacheKey = `community:challenges:communityId:${dto.communityId}`;
    await this.redisService.del(cacheKey);
    await this.redisService.del(listCacheKey);

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
          challengeId: new Types.ObjectId(dto.challengeId),
          isActive: true,
        },
        { isActive: false },
      );
    if (!participant) {
      throw new BadRequestException('you are not the part of this challenge');
    }

    await this.communityChallengeModel.updateOne(
      { _id: new Types.ObjectId(dto.challengeId) },
      { $inc: { memberCount: -1 } },
    );

    // Clear cache
    const cacheKey = `community:challenge:single:${dto.challengeId}`;
    const listCacheKey = `community:challenges:communityId:${dto.communityId}`;
    await this.redisService.del(cacheKey);
    await this.redisService.del(listCacheKey);

    return {
      message: 'leaved challenge sucessfully',
      status: true,
    };
  }

  async transferOwnership(
    userId: string,
    groupId: string,
    newOwnerId: string,
  ) {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(groupId) ||
      !Types.ObjectId.isValid(newOwnerId)
    ) {
      throw new BadRequestException('Invalid IDs');
    }

    // Prevent transferring to self
    if (userId === newOwnerId) {
      throw new BadRequestException('Cannot transfer ownership to yourself');
    }

    // Verify current user is the owner
    const currentOwnerMembership = await this.communityGroupMemberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      isActive: true,
      role: GroupMemberRole.OWNER,
    });

    if (!currentOwnerMembership) {
      throw new ForbiddenException('Only the owner can transfer ownership');
    }

    // Verify group exists and is not deleted
    const group = await this.CommunityModel.findOne({
      _id: new Types.ObjectId(groupId),
      isDeleted: false,
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Check if new owner is already a member
    const newOwnerMembership = await this.communityGroupMemberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(newOwnerId),
      isActive: true,
    });

    if (!newOwnerMembership) {
      throw new BadRequestException('New owner must be a member of the group');
    }

    // Get new owner details
    const newOwner = await this.userModel.findById(
      new Types.ObjectId(newOwnerId),
    );
    if (!newOwner) {
      throw new NotFoundException('New owner user not found');
    }

    // Transfer ownership
    await this.communityGroupMemberModel.updateOne(
      { _id: currentOwnerMembership._id },
      { role: GroupMemberRole.MEMBER },
    );

    await this.communityGroupMemberModel.updateOne(
      { _id: newOwnerMembership._id },
      { role: GroupMemberRole.OWNER },
    );

    // Update group ownerId
    await this.CommunityModel.updateOne(
      { _id: new Types.ObjectId(groupId) },
      { ownerId: newOwner._id },
    );

    // Clear all related caches
    const groupCacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${groupId}`;
    const membersCacheKey = `community:members:${groupId}`;
    await this.redisService.del(groupCacheKey);
    await this.redisService.del(membersCacheKey);

    return {
      message: 'Ownership transferred successfully',
      newOwner: { id: newOwner._id, name: newOwner.name, email: newOwner.email },
    };
  }

  async updateChallenge(
    userId: string,
    challengeId: string,
    dto: UpdateChallengeDto,
  ) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(challengeId)) {
      throw new BadRequestException('Invalid IDs');
    }

    const challenge = await this.communityChallengeModel.findById(
      new Types.ObjectId(challengeId),
    );

    if (!challenge || challenge.isDeleted) {
      throw new NotFoundException('Challenge not found');
    }

    // Verify user is the owner of the group
    const isOwner = await this.communityGroupMemberModel.findOne({
      groupId: challenge.communityId,
      userId: new Types.ObjectId(userId),
      isActive: true,
      role: GroupMemberRole.OWNER,
    });

    if (!isOwner) {
      throw new ForbiddenException('Only group owner can edit challenges');
    }

    // Update challenge fields
    if (dto.challengeName) challenge.challengeName = dto.challengeName;
    if (dto.description) challenge.description = dto.description;
    if (dto.startDate) challenge.startDate = dto.startDate;
    if (dto.endDate) challenge.endDate = dto.endDate;
    if (dto.challengeGoals) challenge.challengeGoal = dto.challengeGoals;
    if (dto.status !== undefined) challenge.status = dto.status;

    await challenge.save();

    // Clear cache
    const cacheKey = `community:challenge:single:${challengeId}`;
    const listCacheKey = `community:challenges:communityId:${challenge.communityId}`;
    await this.redisService.del(cacheKey);
    await this.redisService.del(listCacheKey);

    return challenge;
  }

  async deleteChallenge(userId: string, challengeId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(challengeId)) {
      throw new BadRequestException('Invalid IDs');
    }

    const challenge = await this.communityChallengeModel.findById(
      new Types.ObjectId(challengeId),
    );

    if (!challenge || challenge.isDeleted) {
      throw new NotFoundException('Challenge not found');
    }

    // Verify user is the owner of the group
    const isOwner = await this.communityGroupMemberModel.findOne({
      groupId: challenge.communityId,
      userId: new Types.ObjectId(userId),
      isActive: true,
      role: GroupMemberRole.OWNER,
    });

    if (!isOwner) {
      throw new ForbiddenException('Only group owner can delete challenges');
    }

    challenge.isDeleted = true;
    await challenge.save();

    // Deactivate all participants in this challenge
    await this.communityChallengeParticipantModel.updateMany(
      { challengeId: challenge._id, isActive: true },
      { isActive: false },
    );

    // Clear cache
    const cacheKey = `community:challenge:single:${challengeId}`;
    const listCacheKey = `community:challenges:communityId:${challenge.communityId}`;
    await this.redisService.del(cacheKey);
    await this.redisService.del(listCacheKey);

    return { message: 'Challenge deleted successfully' };
  }

  async leaveGroup(userId: string, groupId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException('Invalid IDs');
    }

    // Check if user is a member
    const membership = await this.communityGroupMemberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      isActive: true,
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of this group');
    }

    // Owners cannot leave - they must transfer ownership first
    if (membership.role === GroupMemberRole.OWNER) {
      throw new ForbiddenException(
        'Owners cannot leave the group. Please transfer ownership first or delete the group.',
      );
    }

    // Deactivate membership
    membership.isActive = false;
    await membership.save();

    // Decrement member count
    await this.CommunityModel.updateOne(
      { _id: new Types.ObjectId(groupId) },
      { $inc: { memberCount: -1 } },
    );

    // Deactivate all challenge participations in this group
    await this.communityChallengeParticipantModel.updateMany(
      {
        communityId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
        isActive: true,
      },
      { isActive: false },
    );

    // Update challenge member counts for all challenges user was part of
    const userChallenges = await this.communityChallengeParticipantModel.find({
      communityId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
    }).distinct('challengeId');

    if (userChallenges.length > 0) {
      await this.communityChallengeModel.updateMany(
        { _id: { $in: userChallenges } },
        { $inc: { memberCount: -1 } },
      );
    }

    // Clear caches
    const groupCacheKey = `${this.SINGLE_COMMUNITY_CACHE_KEY}:${groupId}`;
    const challengesCacheKey = `community:challenges:communityId:${groupId}`;
    const membersCacheKey = `community:members:${groupId}`;
    await this.redisService.del(groupCacheKey);
    await this.redisService.del(challengesCacheKey);
    await this.redisService.del(membersCacheKey);

    return { message: 'Left group successfully' };
  }
}
