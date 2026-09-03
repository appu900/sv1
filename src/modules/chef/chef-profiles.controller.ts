import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChefProfileService } from './chef-profile.service';
import { CreateChefProfileDto } from './dto/create-chef-profile.dto';
import { UpdateChefProfileDto } from './dto/update-chef-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

const chefProfileImageProperties = {
  avatar: {
    type: 'string',
    format: 'binary',
    description: 'Chef avatar image (field name `avatar`).',
  },
  hero: {
    type: 'string',
    format: 'binary',
    description: 'Chef hero / banner image (field name `hero`).',
  },
};

@ApiTags('Chef Profiles')
@Controller('chef-profiles')
export class ChefProfilesController {
  constructor(private readonly chefProfileService: ChefProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List all chef profiles',
    description:
      'Admin catalogue of every chef profile (published and unpublished). Requires JWT and role `admin`.',
  })
  @ApiOkResponse({ description: 'All chef profiles for admin management.' })
  findAll() {
    return this.chefProfileService.findAllAdmin();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CHEF)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get or create my chef profile',
    description:
      'Returns the authenticated chef’s own profile, creating a draft if none exists. Requires JWT and role `chef`.',
  })
  @ApiOkResponse({ description: 'The caller’s chef profile.' })
  getMe(@GetUser() user: any) {
    return this.chefProfileService.getOrCreateForUser(user.userId);
  }

  @Get('by-user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get chef profile by user id',
    description:
      'Looks up the chef profile linked to a user account. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'userId', description: 'User Mongo ObjectId that owns the chef profile.' })
  @ApiOkResponse({ description: 'Chef profile for the given user, if one exists.' })
  findByUserId(@Param('userId') userId: string) {
    return this.chefProfileService.findByUserId(userId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CHEF)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update my chef profile',
    description:
      'Chef self-service update of display fields, social links, and optional avatar/hero uploads. Send `multipart/form-data`. Requires JWT and role `chef`. Social links may be a JSON `socialLinks` object or flat instagram/youtube/tiktok/facebook/website/linkedin fields.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 120 },
        slug: { type: 'string', maxLength: 80 },
        country: { type: 'string' },
        quote: { type: 'string', maxLength: 240 },
        bio: { type: 'string', maxLength: 4000 },
        socialLinks: {
          type: 'string',
          description: 'JSON object of social URLs, or use the flat social fields below.',
        },
        instagram: { type: 'string' },
        youtube: { type: 'string' },
        tiktok: { type: 'string' },
        facebook: { type: 'string' },
        website: { type: 'string' },
        linkedin: { type: 'string' },
        featuredCuisineIds: {
          type: 'string',
          description: 'JSON array or comma-separated cuisine ObjectIds.',
        },
        contactEmail: { type: 'string' },
        mobileNumber: { type: 'string' },
        preferredContactName: { type: 'string' },
        organisation: { type: 'string' },
        isPublished: { type: 'boolean' },
        order: { type: 'number' },
        ...chefProfileImageProperties,
      },
    },
  })
  @ApiOkResponse({ description: 'Updated chef profile for the caller.' })
  updateMe(
    @GetUser() user: any,
    @Body() dto: UpdateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    return this.chefProfileService.updateMe(user.userId, dto, files);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Get chef profile by id',
    description:
      'Admin fetch of a single chef profile by its document id. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Chef profile document.' })
  findOne(@Param('id') id: string) {
    return this.chefProfileService.findOneAdmin(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create chef profile',
    description:
      'Admin creates a chef profile for an existing user and optionally uploads avatar and hero images. Send `multipart/form-data`. Requires JWT and role `admin`. `userId` and `displayName` are required.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId', 'displayName'],
      properties: {
        userId: { type: 'string', description: 'User Mongo ObjectId to attach this profile to.' },
        displayName: { type: 'string', maxLength: 120 },
        slug: { type: 'string', maxLength: 80 },
        country: { type: 'string' },
        quote: { type: 'string', maxLength: 240 },
        bio: { type: 'string', maxLength: 4000 },
        socialLinks: {
          type: 'string',
          description: 'JSON object of social URLs.',
        },
        featuredCuisineIds: {
          type: 'string',
          description: 'JSON array or comma-separated cuisine ObjectIds.',
        },
        isPublished: { type: 'boolean' },
        order: { type: 'number' },
        ...chefProfileImageProperties,
      },
    },
  })
  @ApiCreatedResponse({ description: 'Chef profile created.' })
  async create(
    @Body() dto: CreateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    const profile = await this.chefProfileService.create(dto, files);
    return { message: 'Chef profile created', profile };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'hero', maxCount: 1 },
    ]),
  )
  @ApiJwtRoles()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update chef profile',
    description:
      'Admin update of any chef profile fields plus optional avatar/hero replacements. Send `multipart/form-data`. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', maxLength: 120 },
        slug: { type: 'string', maxLength: 80 },
        country: { type: 'string' },
        quote: { type: 'string', maxLength: 240 },
        bio: { type: 'string', maxLength: 4000 },
        socialLinks: {
          type: 'string',
          description: 'JSON object of social URLs, or use the flat social fields.',
        },
        instagram: { type: 'string' },
        youtube: { type: 'string' },
        tiktok: { type: 'string' },
        facebook: { type: 'string' },
        website: { type: 'string' },
        linkedin: { type: 'string' },
        featuredCuisineIds: {
          type: 'string',
          description: 'JSON array or comma-separated cuisine ObjectIds.',
        },
        contactEmail: { type: 'string' },
        mobileNumber: { type: 'string' },
        preferredContactName: { type: 'string' },
        organisation: { type: 'string' },
        isPublished: { type: 'boolean' },
        order: { type: 'number' },
        ...chefProfileImageProperties,
      },
    },
  })
  @ApiOkResponse({ description: 'Chef profile updated.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChefProfileDto,
    @UploadedFiles()
    files?: { avatar?: Express.Multer.File[]; hero?: Express.Multer.File[] },
  ) {
    const profile = await this.chefProfileService.update(id, dto, files);
    return { message: 'Chef profile updated', profile };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Delete chef profile',
    description:
      'Admin delete. Soft-deletes by default; pass `hard=true` to permanently remove the document. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId.' })
  @ApiQuery({
    name: 'hard',
    required: false,
    description: 'Set to `true` for a hard delete. Any other value (or omit) soft-deletes.',
  })
  @ApiOkResponse({ description: 'Chef profile deleted or soft-deleted.' })
  remove(
    @Param('id') id: string,
    @Query('hard') hard?: string,
  ) {
    return this.chefProfileService.remove(id, hard === 'true');
  }

  @Post(':id/recompute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Recompute chef impact',
    description:
      'Admin job that recomputes cached impact stats (meals, money, food saved) for one chef profile. Requires JWT and role `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Recomputed impact snapshot for the chef.' })
  recompute(@Param('id') id: string) {
    return this.chefProfileService.recompute(id);
  }
}
