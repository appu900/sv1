import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { CommunityGroupsService } from './community-groups.service';
import { CreateCommunityGroupDto } from './dto/create-community-group.dto';
import { UpdateCommunityGroupDto } from './dto/update-community-group.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { User, UserRole } from 'src/database/schemas/user.auth.schema';
import { UseGuards } from '@nestjs/common';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JoinGroupDto } from './dto/Join-group.Memebr.dto';
import { userInfo } from 'os';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { JoinChallengeDto } from './dto/join-challenge.to';
import { leveChallengeDto } from './dto/leaveChallenege.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

@Controller('community-groups')
export class CommunityGroupsController {
  constructor(
    private readonly communityGroupsService: CommunityGroupsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'profileImage', maxCount: 1 }]),
  )
  create(
    @Body() createCommunityGroupDto: CreateCommunityGroupDto,
    @GetUser() user: any,
    @UploadedFiles() files: { profileImage: Express.Multer.File[] },
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    console.log(files);
    return this.communityGroupsService.create(
      createCommunityGroupDto,
      userId,
      files,
    );
  }

  @Post('join-group')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async joinGroupByCode(@Body() dto: JoinGroupDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.joinGroupByCode(dto, userId);
  }

  @Get('/individual-created')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAllOwnedComunityByUserId(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.findAllCommunityGroupByUserId(userId);
  }

  @Get('/userGroups')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async fetchGroupsForUserId(@GetUser() user: any) {
    const userId = user.userId;
    console.log('this one');
    return this.communityGroupsService.getUserGroups(userId);
  }

  @Get(':id')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  fetchCommunityById(@Param('id') communityId: string, @GetUser() user: any) {
    return this.communityGroupsService.findOne(communityId);
  }

  // ** update group only group owner can update
  @Patch('')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'groupProfileImage', maxCount: 1 }]),
  )
  update(
    @Body() updateCommunityDto: UpdateCommunityGroupDto,
    @GetUser() user: any,
    @UploadedFiles() file: { groupProfileImage: Express.Multer.File[] },
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.update(updateCommunityDto, userId, file);
  }

  @Delete(':id')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard,RolesGuard)
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if(!userId) throw new UnauthorizedException();
    return this.communityGroupsService.remove(id, userId);
  }

  // Challenge endpoints
  @Post('challenges')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  createChallenge(@Body() dto: CreateChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.createChallenge(userId, dto);
  }

  @Get(':communityId/challenges')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  getChallengesByCommunity(@Param('communityId') communityId: string) {
    return this.communityGroupsService.getChallangesByCommunityId(communityId);
  }

  @Get('challenges/:challengeId')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  getChallengeById(@Param('challengeId') challengeId: string) {
    return this.communityGroupsService.getChallengeById(challengeId);
  }

  @Post('challenges/join')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  joinChallenge(@Body() dto: JoinChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.joinChallenge(userId, dto);
  }

  @Post('challenges/leave')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  leaveChallenge(@Body() dto: leveChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.leaveChallenge(dto, userId);
  }

  @Post('transfer-ownership')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  transferOwnership(@Body() dto: TransferOwnershipDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.transferOwnership(userId, dto.groupId, dto.newOwnerId);
  }

  @Patch('challenges/:challengeId')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  updateChallenge(
    @Param('challengeId') challengeId: string,
    @Body() dto: UpdateChallengeDto,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.updateChallenge(userId, challengeId, dto);
  }

  @Delete('challenges/:challengeId')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  deleteChallenge(
    @Param('challengeId') challengeId: string,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.deleteChallenge(userId, challengeId);
  }

  @Post(':groupId/leave')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  leaveGroup(
    @Param('groupId') groupId: string,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.leaveGroup(userId, groupId);
  }
}
