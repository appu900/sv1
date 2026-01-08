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
import { JoinGroupDto } from './dto/Join-group.Memebr.dto';

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
    console.log(files);
    return this.communityGroupsService.create(
      createCommunityGroupDto,
      userId,
      files,
    );
  }

  @Get('/individual-created')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAllOwnedComunityByUserId(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.findAllCommunityGroupByUserId(userId);
  }


  @Get(':id')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard,RolesGuard)
  fetchCommunityById(@Param() communityId:string,@GetUser() user:any){
    return this.communityGroupsService.findOne(communityId)
  }

  @Post('join-group')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async joinGroupByCode(@Body() dto: JoinGroupDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.communityGroupsService.joinGroupByCode(dto, userId);
  }

  // ** update group only group owner can update
  @Patch('')
  @Roles(UserRole.USER)
  @UseGuards(JwtAuthGuard,RolesGuard)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'groupProfileImage', maxCount: 1 }]),
  )
  update(@Body() updateCommunityDto: UpdateCommunityGroupDto,@GetUser() user:any,@UploadedFiles() file:{groupProfileImage:Express.Multer.File[]}) {
    const userId = user.userId;
    if(!userId) throw new UnauthorizedException();
    return this.communityGroupsService.update(updateCommunityDto,userId,file)

  }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.communityGroupsService.remove(+id);
  // }
}
