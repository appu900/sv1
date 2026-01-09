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
    const userRole = dto.role ? (dto.role.toUpperCase() as UserRole) : UserRole.USER;
    if (existing) throw new BadRequestException('email already registered');
    const passwordhash = await bcrypt.hash(dto.password, 10);
    
    // Build dietary profile if any fields are provided
    const dietaryProfile = (dto.vegType || dto.dairyFree || dto.nutFree || dto.glutenFree || dto.hasDiabetes || dto.otherAllergies || dto.noOfAdults !== undefined || dto.noOfChildren !== undefined || dto.tastePreference)
      ? {
          vegType: dto.vegType || 'OMNI',
          dairyFree: dto.dairyFree || false,
          nutFree: dto.nutFree || false,
          glutenFree: dto.glutenFree || false,
          hasDiabetes: dto.hasDiabetes || false,
          otherAllergies: dto.otherAllergies || [],
          noOfAdults: dto.noOfAdults || 0,
          noOfChildren: dto.noOfChildren || 0,
          tastePrefrence: dto.tastePreference || [],
        }
      : undefined;

    const user = await this.userService.create({
      email: dto.email,
      passwordHash: passwordhash,
      name: dto.name,
      role: userRole,
      country: dto.country,
      stateCode: dto.stateCode,
      dietaryProfile,
    });

    // Generate session and token for auto-login after signup
    const sessionId = nanoid();
    await this.redis.setSession(sessionId, user._id.toString(), 60 * 60 * 24 * 7);
    const accessToken = this.generateAccessToken(
      user._id.toString(),
      user.role,
      sessionId,
    );

    // ** create user foodanalytics profile

    const userFoodProfileId = await this.userService.createUserFoodAnalyticsProfile(user._id)

    return {
      success: true,
      message: 'user created sucessfully',
      accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        analyticsProfileId:userFoodProfileId
      },
      
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
    const sessionId = nanoid();
    await this.redis.setSession(sessionId, user._id.toString(), 60 * 60 * 24 * 7);
    const accessToken = this.generateAccessToken(
      user._id.toString(),
      user.role,
      sessionId,
    );
    return {
      success: true,
      message: 'login sucessful',
      accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async loginWithRole(dto: UserLoginDto, requiredRole: UserRole) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid Credentials');
    }
    
    if (user.role !== requiredRole) {
      throw new UnauthorizedException(`Access denied. This login is only for ${requiredRole.toLowerCase()}s.`);
    }
    
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid Credentials');
    
    const sessionId = nanoid();
    await this.redis.setSession(sessionId, user._id.toString(), 60 * 60 * 24 * 7);
    const accessToken = this.generateAccessToken(
      user._id.toString(),
      user.role,
      sessionId,
    );
    
    return {
      success: true,
      message: 'login successful',
      accessToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async getProfile(userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('invalid userId');
    const user = await this.userService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
