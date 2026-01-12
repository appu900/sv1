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
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { GetUser } from 'src/common/decorators/Get.user.decorator';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() createFeedbackDto: CreateFeedbackDto, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.create(userId, createFeedbackDto);
  }

  @Get()
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAll(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.findAll(userId);
  }

  @Get('stats')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  getStats(@GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.getStats(userId);
  }

  @Get(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findOne(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.findOne(id, userId);
  }

  @Post(':id/update')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Param('id') id: string,
    @Body() updateFeedbackDto: UpdateFeedbackDto,
    @GetUser() user: any,
  ) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.update(id, userId, updateFeedbackDto);
  }

  @Delete(':id')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(@Param('id') id: string, @GetUser() user: any) {
    const userId = user.userId;
    if (!userId) throw new UnauthorizedException();
    return this.feedbackService.delete(id, userId);
  }
}
