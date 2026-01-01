import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/user.register.dto';
import { UserLoginDto } from './dto/user.login.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authservice: AuthService) {}

  @Post('')
  async register(@Body('') dto: RegisterUserDto) {
    return this.authservice.register(dto);
  }

  @Post('login')
  async Login(@Body('') dto: UserLoginDto) {
    return this.authservice.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@GetUser() user:any) {
    return this.authservice.getProfile(user.userId);
    
  }
}
