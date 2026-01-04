import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { CommunityGroupsService } from './community-groups.service';
import { CreateCommunityGroupDto } from './dto/create-community-group.dto';
import { UpdateCommunityGroupDto } from './dto/update-community-group.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { User, UserRole } from 'src/database/schemas/user.auth.schema';
import { UseGuards } from '@nestjs/common';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

@Controller('community-groups')
export class CommunityGroupsController {
  constructor(
    private readonly communityGroupsService: CommunityGroupsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'profileImage', maxCount: 1 }]),
  )
  create(
    @Body() createCommunityGroupDto: CreateCommunityGroupDto,
    @GetUser() user: any,
    @UploadedFiles() files: { profileImage: Express.Multer.File[] },
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    console.log(files)
    return this.communityGroupsService.create(
      createCommunityGroupDto,
      userId,
      files,
    );
  }
  

  @Get('/individual-created')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard,RolesGuard)
  findAllOwnedComunityByUserId(@GetUser() user:any) {
    const userId = user.userId;
    if(!userId) throw new UnauthorizedException()
    return this.communityGroupsService.findAllCommunityGroupByUserId(userId)
  }

  

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCommunityGroupDto: UpdateCommunityGroupDto,
  ) {
    return this.communityGroupsService.update(+id, updateCommunityGroupDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.communityGroupsService.remove(+id);
  }
}
