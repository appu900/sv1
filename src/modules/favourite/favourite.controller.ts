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
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { FavouriteService } from './favourite.service';
import { CreateFavouriteDto } from './dto/create-favourite.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Favourites')
@Controller('favourites')
export class FavouriteController {
  constructor(private readonly favouriteService: FavouriteService) {}

  @Post()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Add a favourite',
    description:
      'Favourites a framework item for the authenticated user. Body requires `type` and `framework_id`. Duplicate favourites are rejected. Requires JWT and role `user` or `admin`.',
  })
  @ApiBody({ type: CreateFavouriteDto })
  @ApiCreatedResponse({ description: 'Favourite created for the caller.' })
  create(@Body() createFavouriteDto: CreateFavouriteDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.create(userId, createFavouriteDto);
  }

  @Get()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List my favourites',
    description:
      'Returns the authenticated user’s favourite records (ids and types, not expanded entities). Requires JWT and role `user` or `admin`.',
  })
  @ApiOkResponse({ description: 'Favourite records for the caller.' })
  findAll(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.findAll(userId);
  }

  @Get('details')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'List my favourites with details',
    description:
      'Returns the authenticated user’s favourites with the related framework/recipe documents populated. Requires JWT and role `user` or `admin`.',
  })
  @ApiOkResponse({ description: 'Favourites with populated entity details.' })
  findAllDetails(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.findAllDetailed(userId);
  }

  @Delete(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiJwtRoles()
  @ApiOperation({
    summary: 'Remove a favourite',
    description:
      'Deletes a favourite owned by the authenticated user. Requires JWT and role `user` or `admin`.',
  })
  @ApiParam({ name: 'id', description: 'Favourite Mongo ObjectId.' })
  @ApiOkResponse({ description: 'Favourite removed.' })
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.favouriteService.remove(id, userId);
  }
}
