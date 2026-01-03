import {
  Controller,
  Body,
  Get,
  Put,
  Delete,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { IngredientsService } from './ingredients.service';
import { CreateCatgoryDto } from './dto/ingrediants.category.dto';
import { Roles } from 'src/common/decorators/role.decorators';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingrediantsService: IngredientsService) {}


  @Post('category')
  @Roles('ADMIN', 'CHEF')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async createCategory(
    @Body() dto: CreateCatgoryDto,
    @UploadedFiles() files: { image: Express.Multer.File[] },
  ) {
    return this.ingrediantsService.create(dto, files);
  }

  @Get('category')
  async fetchCategory(
  ) {
    return this.ingrediantsService.getAllCategories()
  }
}
