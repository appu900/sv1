import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { FavouriteService } from './favourite.service';
import { CreateFavouriteDto } from './dto/create-favourite.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { GetUser } from 'src/common/decorators/Get.user.decorator';

@Controller('favourites')
export class FavouriteController {
  constructor(private readonly favouriteService: FavouriteService) {}

  @Post()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() createFavouriteDto: CreateFavouriteDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.create(userId, createFavouriteDto);
  }

  @Get()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAll(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.findAll(userId);
  }

  @Get('details')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAllDetails(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.findAllDetailed(userId);
  }

  @Delete(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.remove(id, userId);
  }
}
