import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from 'src/redis/redis.service';
import { RegisterUserDto } from './dto/user.register.dto';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { UserLoginDto } from './dto/user.login.dto';
import { nanoid } from 'nanoid';
import { Types } from 'mongoose';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly userService: UserService,
  ) {}

  private generateAccessToken(userId: string, role: string, sessionId: string) {
    return this.jwt.sign({ sub: userId, sid: sessionId, role: role });
  }

  async register(dto: RegisterUserDto) {
    const existing = await this.userService.findByEmail(dto.email);
    const userRole = dto.role.toUpperCase() as UserRole;
    if (existing) throw new BadRequestException('email already registered');
    const passwordhash = await bcrypt.hash(dto.password, 10);
    const user = await this.userService.create({
      email: dto.email,
      passwordHash: passwordhash,
      name: dto.name,
      role: userRole,
    });
    return {
      message: 'user created sucessfully',
      id: user._id,
      email: user.email,
    };
  }

  async login(dto: UserLoginDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid Crediantls');
    }
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid Credentials');
    // const key = `auth:session:${sessionId}`;
    const sessionId = nanoid();
    await this.redis.setSession(sessionId, user._id.toString(), 60 * 60);
    const accessToken = this.generateAccessToken(
      user._id.toString(),
      user.role,
      sessionId,
    );
    return {
      message: 'login sucessful',
      userId: user._id,
      email: user.email,
      accessToken,
    };
  }

  async getProfile(userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('invalid userId');
    const user = await this.userService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
