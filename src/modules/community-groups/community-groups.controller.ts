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
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
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
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Community Groups')
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
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a community group',
    description:
      'Creates a group owned by the authenticated user and optionally uploads a profile image. Send `multipart/form-data` with `name`, `description`, and file field `profileImage`. Requires JWT and role `user` or `admin`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'description'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        profileImage: {
          type: 'string',
          format: 'binary',
          description: 'Group profile image (field name `profileImage`).',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Community group created.' })
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
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Join a group by invite code',
    description:
      'Adds the authenticated user to a community group using its invite `code`. Requires JWT and role `user`.',
  })
  @ApiBody({ type: JoinGroupDto })
  @ApiOkResponse({ description: 'Caller joined the group.' })
  async joinGroupByCode(@Body() dto: JoinGroupDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.joinGroupByCode(dto, userId);
  }

  @Get('/individual-created')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Groups I created',
    description:
      'Lists community groups owned by the authenticated user. Declared before `:id` so this path is not captured as an id. Requires JWT and role `user`.',
  })
  @ApiOkResponse({ description: 'Groups the caller owns.' })
  findAllOwnedComunityByUserId(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.findAllCommunityGroupByUserId(userId);
  }

  @Get('/userGroups')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Groups I belong to',
    description:
      'Lists community groups the authenticated user is a member of (owned and joined). Declared before `:id`. Requires JWT and role `user`.',
  })
  @ApiOkResponse({ description: 'Groups the caller is a member of.' })
  async fetchGroupsForUserId(@GetUser() user: any) {
    const userId = user.userId;
    return this.communityGroupsService.getUserGroups(userId);
  }

  @Get(':id')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get community group',
    description:
      'Fetches a single community group by id. Static routes (`individual-created`, `userGroups`) are registered first so they are not treated as ids. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'id', description: 'Community group Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Community group document.' })
  fetchCommunityById(@Param('id') communityId: string, @GetUser() user: any) {
    return this.communityGroupsService.findOne(communityId);
  }

  @Patch('')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'groupProfileImage', maxCount: 1 }]),
  )
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update a community group',
    description:
      'Updates group name/description and optionally replaces the profile image. Send `multipart/form-data` with required `groupId` and file field `groupProfileImage`. Only the owner can update. Requires JWT and role `user`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['groupId'],
      properties: {
        groupId: { type: 'string', description: 'Community group Mongo ObjectId to update.' },
        name: { type: 'string' },
        description: { type: 'string' },
        groupProfileImage: {
          type: 'string',
          format: 'binary',
          description: 'Replacement group image (field name `groupProfileImage`).',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Community group updated.' })
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
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Delete a community group',
    description:
      'Deletes a community group. Only the owner (authenticated user) can delete. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'id', description: 'Community group Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Community group deleted.' })
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if(!userId) throw new UnauthorizedException();
    return this.communityGroupsService.remove(id, userId);
  }

  @Post('challenges')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Create a challenge',
    description:
      'Creates a challenge on a community group (`communityId`, name, dates, description, `challengeGoals`). Typically restricted to the group owner in the service. Requires JWT and role `user`.',
  })
  @ApiBody({ type: CreateChallengeDto })
  @ApiCreatedResponse({ description: 'Challenge created on the group.' })
  createChallenge(@Body() dto: CreateChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.createChallenge(userId, dto);
  }

  @Get(':communityId/challenges')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List challenges for a group',
    description:
      'Returns challenges belonging to `communityId`, personalised with the caller’s join state when a user is present. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'communityId', description: 'Community group Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Challenges for the community group.' })
  getChallengesByCommunity(@Param('communityId') communityId: string, @GetUser() user: any) {
    const userId = user?.userId;
    return this.communityGroupsService.getChallangesByCommunityId(communityId, userId);
  }

  @Get('challenges/:challengeId')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get a challenge',
    description:
      'Fetches one challenge by id, including the caller’s participation. Path is `/community-groups/challenges/:challengeId` (not captured by `:id`). Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'challengeId', description: 'Challenge Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Challenge document for the caller.' })
  getChallengeById(@Param('challengeId') challengeId: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.getChallengeById(challengeId, userId);
  }

  @Post('challenges/join')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Join a challenge',
    description:
      'Adds the authenticated user to a challenge. Body uses `communityId` and `challnageId` (legacy spelling). Requires JWT and role `user`.',
  })
  @ApiBody({ type: JoinChallengeDto })
  @ApiOkResponse({ description: 'Caller joined the challenge.' })
  joinChallenge(@Body() dto: JoinChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.joinChallenge(userId, dto);
  }

  @Post('challenges/leave')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Leave a challenge',
    description:
      'Removes the authenticated user from a challenge. Body requires `communityId` and `challengeId`. Requires JWT and role `user`.',
  })
  @ApiBody({ type: leveChallengeDto })
  @ApiOkResponse({ description: 'Caller left the challenge.' })
  leaveChallenge(@Body() dto: leveChallengeDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.leaveChallenge(dto, userId);
  }

  @Post('transfer-ownership')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Transfer group ownership',
    description:
      'Transfers ownership of a group from the authenticated owner to `newOwnerId`. Body requires `groupId` and `newOwnerId`. Requires JWT and role `user`.',
  })
  @ApiBody({ type: TransferOwnershipDto })
  @ApiOkResponse({ description: 'Group ownership transferred.' })
  transferOwnership(@Body() dto: TransferOwnershipDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.transferOwnership(userId, dto.groupId, dto.newOwnerId);
  }

  @Patch('challenges/:challengeId')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Update a challenge',
    description:
      'Updates challenge name, description, dates, goals, or status. Typically owner-only in the service. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'challengeId', description: 'Challenge Mongo ObjectId.' })
  @ApiBody({ type: UpdateChallengeDto })
  @ApiOkResponse({ description: 'Challenge updated.' })
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
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Delete a challenge',
    description:
      'Deletes a challenge. Typically owner-only in the service. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'challengeId', description: 'Challenge Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Challenge deleted.' })
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
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Leave a community group',
    description:
      'Removes the authenticated user from the group. Owners should transfer ownership first. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'groupId', description: 'Community group Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Caller left the group.' })
  leaveGroup(
    @Param('groupId') groupId: string,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.leaveGroup(userId, groupId);
  }
  @Post('challenges/:challengeId/finalize')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Finalize a challenge and award badges',
    description:
      'Closes a challenge and awards winner badges to the top N participants (`topWinnersCount`, default 3). Typically owner-only in the service. Requires JWT and role `user`.',
  })
  @ApiParam({ name: 'challengeId', description: 'Challenge Mongo ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        topWinnersCount: {
          type: 'number',
          description: 'How many top participants receive winner badges. Defaults to 3.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Challenge finalized and badges awarded.' })
  finalizeChallenge(
    @Param('challengeId') challengeId: string,
    @Body() body: { topWinnersCount?: number },
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.finalizeChallengeAndAwardBadges(
      userId,
      challengeId,
      body.topWinnersCount || 3,
    );
  }

  @Post('challenges/auto-finalize')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Auto-finalize expired challenges',
    description:
      'Triggers finalization for expired challenges. Any authenticated user may call this; the service applies group-owner permissions internally. Optional `topWinnersCount` defaults to 3. Requires JWT and role `user`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        topWinnersCount: {
          type: 'number',
          description: 'How many top participants receive winner badges. Defaults to 3.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Expired challenges finalized.' })
  autoFinalizeChallenges(
    @Body() body: { topWinnersCount?: number },
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    // Anyone authenticated can trigger; service uses group owner for permissions internally
    return this.communityGroupsService.autoFinalizeExpiredChallenges(
      body.topWinnersCount || 3,
    );
  }
}
