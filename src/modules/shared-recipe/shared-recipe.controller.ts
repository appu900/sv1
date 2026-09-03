import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SharedRecipeService } from './shared-recipe.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import {
  ShareRecipeDto,
  LikeSharedRecipeDto,
  SaveSharedRecipeDto,
} from './dto/share-recipe.dto';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Shared Recipes')
@Controller('shared-recipes')
export class SharedRecipeController {
  constructor(private readonly sharedRecipeService: SharedRecipeService) {}

  private resolveUserId(user: any): string {
    const id = user?.userId ?? user?.id ?? user?._id ?? user?.sub ?? '';
    if (!id) throw new UnauthorizedException();
    return String(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Share a recipe',
    description:
      'Shares one of the caller’s recipes to a community (`shareType=community` + `communityId`) or to the public feed (`shareType=public`). Optional `message` is capped at 300 characters. Requires JWT and role `user` or `admin`.',
  })
  @ApiBody({ type: ShareRecipeDto })
  @ApiCreatedResponse({ description: 'Shared-recipe record created.' })
  shareRecipe(@Body() dto: ShareRecipeDto, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.shareRecipe(userId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Unshare a recipe',
    description:
      'Removes a share owned by the authenticated user. Requires JWT and role `user` or `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Shared-recipe Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Share removed.' })
  unshareRecipe(@Param('id') id: string, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.unshareRecipe(userId, id);
  }

  @Get('community/:communityId')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Community shared recipes',
    description:
      'Paginated recipes shared into a community group. `limit` is capped at 50 (default 20). Requires JWT and role `user` or `admin`.',
  })
  @ApiParam({ name: 'communityId', description: 'Community group Mongo ObjectId.' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number. Defaults to 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size, max 50. Defaults to 20.',
  })
  @ApiOkResponse({ description: 'Paginated community shared recipes for the caller.' })
  getCommunityRecipes(
    @Param('communityId') communityId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @GetUser() user: any,
  ) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.getCommunityRecipes(
      userId,
      communityId,
      page,
      Math.min(limit, 50),
    );
  }

  @Get('public')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Public shared recipes',
    description:
      'Paginated public recipe feed. `limit` is capped at 50 (default 20). Requires JWT and role `user` or `admin`.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: '1-based page number. Defaults to 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size, max 50. Defaults to 20.',
  })
  @ApiOkResponse({ description: 'Paginated public shared recipes.' })
  getPublicRecipes(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @GetUser() user: any,
  ) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.getPublicRecipes(
      userId,
      page,
      Math.min(limit, 50),
    );
  }

  @Post('like')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Toggle like on a shared recipe',
    description:
      'Likes or unlikes a shared recipe for the authenticated user. Requires JWT and role `user` or `admin`.',
  })
  @ApiBody({ type: LikeSharedRecipeDto })
  @ApiOkResponse({ description: 'Updated like state for the shared recipe.' })
  toggleLike(@Body() dto: LikeSharedRecipeDto, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.toggleLike(userId, dto.sharedRecipeId);
  }

  @Post('save')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Save shared recipe to my cookbook',
    description:
      'Copies a shared recipe into the authenticated user’s cookbook. Requires JWT and role `user` or `admin`.',
  })
  @ApiBody({ type: SaveSharedRecipeDto })
  @ApiOkResponse({ description: 'Shared recipe saved to the caller’s cookbook.' })
  saveToMyCookbook(@Body() dto: SaveSharedRecipeDto, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.saveToMyCookbook(
      userId,
      dto.sharedRecipeId,
    );
  }

  /** Get shares for a specific recipe by the current user */
  @Get('my-shares/:recipeId')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'My shares for a recipe',
    description:
      'Lists how the authenticated user has already shared a given source recipe (community and/or public). Requires JWT and role `user` or `admin`.',
  })
  @ApiParam({ name: 'recipeId', description: 'Source recipe Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Existing shares of this recipe by the caller.' })
  getMyShares(@Param('recipeId') recipeId: string, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.getMyShares(userId, recipeId);
  }
}
