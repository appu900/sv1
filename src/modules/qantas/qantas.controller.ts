import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QantasService } from './qantas.service';
import { LinkFFNDto } from './dto/link-ffn.dto';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('qantas')
@UseGuards(JwtAuthGuard)
export class QantasController {
  constructor(private readonly qantasService: QantasService) {}

  @Get()
  async getFFN(@GetUser() user: any) {
    return this.qantasService.getFFN(user.userId);
  }

  @Get('dashboard')
  async getDashboard(@GetUser() user: any) {
    return this.qantasService.getDashboard(user.userId);
  }

  @Post('link')
  @HttpCode(HttpStatus.CREATED)
  async linkFFN(@GetUser() user: any, @Body() dto: LinkFFNDto) {
    return this.qantasService.linkFFN(user.userId, dto);
  }

  @Delete('unlink')
  @HttpCode(HttpStatus.OK)
  async unlinkFFN(@GetUser() user: any) {
    return this.qantasService.unlinkFFN(user.userId);
  }
}
