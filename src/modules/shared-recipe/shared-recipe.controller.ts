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
  shareRecipe(@Body() dto: ShareRecipeDto, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.shareRecipe(userId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  unshareRecipe(@Param('id') id: string, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.unshareRecipe(userId, id);
  }

  @Get('community/:communityId')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  toggleLike(@Body() dto: LikeSharedRecipeDto, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.toggleLike(userId, dto.sharedRecipeId);
  }

  @Post('save')
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  getMyShares(@Param('recipeId') recipeId: string, @GetUser() user: any) {
    const userId = this.resolveUserId(user);
    return this.sharedRecipeService.getMyShares(userId, recipeId);
  }
}
