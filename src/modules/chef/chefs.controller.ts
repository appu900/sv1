import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChefService } from './chef.service';
import { ChefFavouriteService } from './chef-favourite.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import {
  ApiJwtRoles,
  ApiOptionalJwt,
} from '../../common/swagger/api-auth.decorators';

@ApiTags('Chefs')
@Controller('chefs')
export class ChefsController {
  constructor(
    private readonly chefService: ChefService,
    private readonly favouriteService: ChefFavouriteService,
  ) {}

  @Get('home')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOptionalJwt()
  @ApiOperation({
    summary: 'Chef home rails',
    description:
      'Returns the chef discovery home payload: popular-this-week chefs and cuisine rails. Optional JWT personalises favourite flags. `country` filters recipe counts and rails to that market.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code used to localise recipe counts and rails (e.g. AU, IN).',
  })
  @ApiOkResponse({ description: 'Home rails with popular chefs and cuisine collections.' })
  getHome(
    @GetUser() user: any,
    @Query('country') country?: string,
  ) {
    return this.chefService.getHome(user?.userId, country);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOptionalJwt()
  @ApiOperation({
    summary: 'List chefs',
    description:
      'Cursor-paginated public chef directory. Optional JWT marks which chefs the viewer has favourited. Filter by search text or cuisine; sort by curated, popular, or alphabetical. Limit is clamped between 1 and 48 (default 24).',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from the previous page.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (1–48, default 24).',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Case-insensitive search against chef display name and related text.',
  })
  @ApiQuery({
    name: 'cuisineId',
    required: false,
    description: 'Mongo ObjectId of a cuisine to restrict the list.',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['curated', 'popular', 'alphabetical'],
    description: 'Sort order. Defaults to curated.',
  })
  @ApiOkResponse({ description: 'Paginated chef cards with next cursor when more results exist.' })
  list(
    @GetUser() user: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('cuisineId') cuisineId?: string,
    @Query('sort') sort?: 'curated' | 'popular' | 'alphabetical',
  ) {
    return this.chefService.listChefs({
      cursor,
      limit: limit ? Number(limit) : undefined,
      q,
      cuisineId,
      sort,
      userId: user?.userId,
    });
  }

  @Get('favourites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List favourite chefs',
    description:
      'Returns the authenticated user or admin’s favourited chefs, cursor-paginated. Requires JWT and role `user` or `admin`.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from the previous page.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (1–48, default 24).',
  })
  @ApiOkResponse({ description: 'Paginated favourite chef cards.' })
  getFavourites(
    @GetUser() user: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chefService.getFavourites(
      user.userId,
      cursor,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('favourites/recipes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Recipes from favourite chefs',
    description:
      'Returns recipes authored by chefs the caller has favourited. Requires JWT and role `user` or `admin`. Optional `country` localises which recipes are included.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from the previous page.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (default 24).',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter recipes for that market.',
  })
  @ApiOkResponse({ description: 'Paginated recipes from the caller’s favourite chefs.' })
  getFavouriteRecipes(
    @GetUser() user: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
  ) {
    return this.chefService.getFavouriteRecipes(
      user.userId,
      cursor,
      limit ? Number(limit) : undefined,
      country,
    );
  }

  @Get('community-impact')
  @ApiOperation({
    summary: 'Community impact snapshot',
    description:
      'Public aggregate of chef-community impact (meals cooked, money saved, food saved) plus awards for the requested period. No auth required. `period` defaults to `month` when omitted or invalid.',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['month', 'year', 'all'],
    description: 'Aggregation window. Defaults to month.',
  })
  @ApiOkResponse({ description: 'Community impact totals and awards for the period.' })
  getCommunityImpact(@Query('period') period?: 'month' | 'year' | 'all') {
    const p =
      period === 'year' || period === 'all' || period === 'month'
        ? period
        : 'month';
    return this.chefService.getCommunityImpact(p);
  }

  @Get('cuisines')
  @ApiOperation({
    summary: 'Chef cuisine library',
    description:
      'Public list of active cuisines with a count of published chefs for each. Includes cuisines that currently have zero published chefs. No auth required.',
  })
  @ApiOkResponse({ description: 'Active cuisines with published-chef counts.' })
  getCuisines() {
    return this.chefService.getCuisines();
  }

  @Get('cuisines/:id')
  @ApiOperation({
    summary: 'Cuisine detail',
    description:
      'Public cuisine record plus the number of published chefs tagged with that cuisine. No auth required.',
  })
  @ApiParam({ name: 'id', description: 'Cuisine Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Cuisine detail and published chef count.' })
  getCuisineDetail(@Param('id') id: string) {
    return this.chefService.getCuisineDetail(id);
  }

  @Get(':slugOrId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOptionalJwt()
  @ApiOperation({
    summary: 'Get chef profile',
    description:
      'Public chef profile by URL slug or Mongo ObjectId. Optional JWT sets whether the viewer has favourited this chef. `country` localises recipe stats on the profile.',
  })
  @ApiParam({
    name: 'slugOrId',
    description: 'Chef profile slug (e.g. jamie-oliver) or Mongo ObjectId.',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to localise recipe stats.',
  })
  @ApiOkResponse({ description: 'Published chef profile card and stats.' })
  getProfile(
    @Param('slugOrId') slugOrId: string,
    @GetUser() user: any,
    @Query('country') country?: string,
  ) {
    return this.chefService.getProfile(slugOrId, user?.userId, country);
  }

  @Get(':id/recipes')
  @ApiOperation({
    summary: 'List chef recipes',
    description:
      'Cursor-paginated public recipes for a published chef. No auth required. `country` filters recipes available in that market. Limit defaults to 24.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from the previous page.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (default 24).',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'ISO country code to filter recipes for that market.',
  })
  @ApiOkResponse({ description: 'Paginated recipes for the chef.' })
  getRecipes(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
  ) {
    return this.chefService.getChefRecipes(
      id,
      cursor,
      limit ? Number(limit) : undefined,
      country,
    );
  }

  @Post(':id/favourite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Favourite a chef',
    description:
      'Adds the chef to the authenticated user or admin’s favourites. Requires JWT and role `user` or `admin`. Idempotent if already favourited.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId to favourite.' })
  @ApiCreatedResponse({ description: 'Chef added to favourites.' })
  addFavourite(@Param('id') id: string, @GetUser() user: any) {
    return this.favouriteService.addFavourite(user.userId, id);
  }

  @Delete(':id/favourite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Unfavourite a chef',
    description:
      'Removes the chef from the authenticated user or admin’s favourites. Requires JWT and role `user` or `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Chef profile Mongo ObjectId to unfavourite.' })
  @ApiOkResponse({ description: 'Chef removed from favourites.' })
  removeFavourite(@Param('id') id: string, @GetUser() user: any) {
    return this.favouriteService.removeFavourite(user.userId, id);
  }
}
