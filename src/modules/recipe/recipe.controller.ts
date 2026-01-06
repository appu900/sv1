import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecipeService } from './recipe.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { JwtAuthGuard } from './../../common/guards/jwt-auth.guard';
import { RolesGuard } from './../../common/guards/roles.guard';
import { Roles } from './../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';

@Controller('api/recipe')
export class RecipeController {
  constructor(private readonly recipeService: RecipeService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileInterceptor('heroImage'))
  async create(
    @Body() createRecipeDto: CreateRecipeDto,
    @UploadedFile() heroImage?: Express.Multer.File,
  ) {
    return this.recipeService.create(createRecipeDto, heroImage);
  }

 
  @Get()
  async findAll() {
    return this.recipeService.findAll();
  }

  @Get('category/:categoryId')
  async findByCategory(@Param('categoryId') categoryId: string) {
    return this.recipeService.findByFrameworkCategory(categoryId);
  }

 
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.recipeService.findOne(id);
  }


  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  @UseInterceptors(FileInterceptor('heroImage'))
  async update(
    @Param('id') id: string,
    @Body() updateRecipeDto: UpdateRecipeDto,
    @UploadedFile() heroImage?: Express.Multer.File,
  ) {
    return this.recipeService.update(id, updateRecipeDto, heroImage);
  }

  
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CHEF)
  async remove(@Param('id') id: string) {
    await this.recipeService.remove(id);
    return { message: 'Recipe deleted successfully' };
  }
}