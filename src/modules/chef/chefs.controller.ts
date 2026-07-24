import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChefService } from './chef.service';
import { ChefFavouriteService } from './chef-favourite.service';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('chefs')
export class ChefsController {
  constructor(
    private readonly chefService: ChefService,
    private readonly favouriteService: ChefFavouriteService,
  ) {}

  @Get('home')
  @UseGuards(OptionalJwtAuthGuard)
  getHome(
    @GetUser() user: any,
    @Query('country') country?: string,
  ) {
    return this.chefService.getHome(user?.userId, country);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
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
  getCommunityImpact(@Query('period') period?: 'month' | 'year' | 'all') {
    const p =
      period === 'year' || period === 'all' || period === 'month'
        ? period
        : 'month';
    return this.chefService.getCommunityImpact(p);
  }

  @Get('cuisines')
  getCuisines() {
    return this.chefService.getCuisines();
  }

  @Get(':slugOrId')
  @UseGuards(OptionalJwtAuthGuard)
  getProfile(
    @Param('slugOrId') slugOrId: string,
    @GetUser() user: any,
    @Query('country') country?: string,
  ) {
    return this.chefService.getProfile(slugOrId, user?.userId, country);
  }

  @Get(':id/recipes')
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
  addFavourite(@Param('id') id: string, @GetUser() user: any) {
    return this.favouriteService.addFavourite(user.userId, id);
  }

  @Delete(':id/favourite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  removeFavourite(@Param('id') id: string, @GetUser() user: any) {
    return this.favouriteService.removeFavourite(user.userId, id);
  }
}
