import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { RecipeRatingsService } from './recipe-ratings.service';
import { CreateRecipeRatingDto } from './dto/create-recipe-rating.dto';
import { UpdateRecipeRatingDto } from './dto/update-recipe-rating.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('recipe-ratings')
export class RecipeRatingsController {
  constructor(private readonly recipeRatingsService: RecipeRatingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Request() req, @Body() createRecipeRatingDto: CreateRecipeRatingDto) {
    return this.recipeRatingsService.create(
      req.user.userId,
      createRecipeRatingDto,
    );
  }

  @Get()
  findAll() {
    return this.recipeRatingsService.findAll();
  }

  @Get('recipe/:recipeId')
  findByRecipe(@Param('recipeId') recipeId: string) {
    return this.recipeRatingsService.findByRecipe(recipeId);
  }

  @Get('recipe/:recipeId/stats')
  getRecipeStats(@Param('recipeId') recipeId: string) {
    return this.recipeRatingsService.getRecipeRatingStats(recipeId);
  }

  @Get('user/my-ratings')
  @UseGuards(JwtAuthGuard)
  findMyRatings(@Request() req) {
    return this.recipeRatingsService.findByUser(req.user.userId);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.recipeRatingsService.findByUser(userId);
  }

  @Get('check')
  @UseGuards(JwtAuthGuard)
  checkUserRating(@Request() req, @Query('recipeId') recipeId: string) {
    return this.recipeRatingsService.findUserRatingForRecipe(
      req.user.userId,
      recipeId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recipeRatingsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateRecipeRatingDto: UpdateRecipeRatingDto,
  ) {
    return this.recipeRatingsService.update(
      id,
      req.user.userId,
      updateRecipeRatingDto,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Request() req, @Param('id') id: string) {
    return this.recipeRatingsService.remove(id, req.user.userId);
  }
}
