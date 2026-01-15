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
    
    // Generate refresh token
    const refreshToken = this.jwt.sign(
      { sub: user._id.toString(), sid: sessionId, role: user.role, type: 'refresh' },
      { expiresIn: '7d' }
    );

    // ** create user foodanalytics profile

    const userFoodProfileId = await this.userService.createUserFoodAnalyticsProfile(user._id)

    return {
      success: true,
      message: 'user created sucessfully',
      accessToken,
      refreshToken,
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
    
    // Generate refresh token (same as access token but stored separately)
    const refreshToken = this.jwt.sign(
      { sub: user._id.toString(), sid: sessionId, role: user.role, type: 'refresh' },
      { expiresIn: '7d' }
    );
    
    return {
      success: true,
      message: 'login sucessful',
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    try {
      // Verify the refresh token
      const payload = this.jwt.verify(refreshToken);
      
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // Check if session is still valid in Redis
      const userId = await this.redis.getSession(payload.sid);
      if (!userId) {
        throw new UnauthorizedException('Session expired');
      }

      // Get user to ensure they still exist
      const user = await this.userService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Generate new tokens
      const newSessionId = nanoid();
      await this.redis.setSession(newSessionId, user._id.toString(), 60 * 60 * 24 * 7);
      
      const newAccessToken = this.generateAccessToken(
        user._id.toString(),
        user.role,
        newSessionId,
      );
      
      const newRefreshToken = this.jwt.sign(
        { sub: user._id.toString(), sid: newSessionId, role: user.role, type: 'refresh' },
        { expiresIn: '7d' }
      );

      return {
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
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
    
    // Transform user data to match app expectations
    // Support both flat fields and nested dietaryProfile
    return {
      id: user._id.toString(),
      _id: user._id, // Keep MongoDB ID for backward compatibility
      email: user.email,
      name: user.name,
      first_name: user.name, // App expects first_name
      role: user.role,
      country: user.country,
      stateCode: user.stateCode,
      
      // Flatten dietary profile for easier access
      vegType: user.dietaryProfile?.vegType || 'OMNI',
      dairyFree: user.dietaryProfile?.dairyFree || false,
      nutFree: user.dietaryProfile?.nutFree || false,
      glutenFree: user.dietaryProfile?.glutenFree || false,
      hasDiabetes: user.dietaryProfile?.hasDiabetes || false,
      otherAllergies: user.dietaryProfile?.otherAllergies || [],
      noOfAdults: user.dietaryProfile?.noOfAdults,
      noOfChildren: user.dietaryProfile?.noOfChildren,
      tastePreference: user.dietaryProfile?.tastePrefrence || [],
      
      // Keep nested structure for backward compatibility
      dietaryProfile: user.dietaryProfile,
    };
  }
}
