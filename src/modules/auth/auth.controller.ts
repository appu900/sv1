import { Controller, Post, Get, Put, Delete, Body, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/user.register.dto';
import { UserLoginDto } from './dto/user.login.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/Get.user.decorator';
import { UserRole } from 'src/database/schemas/user.auth.schema';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/role.decorators';
import { CreateChefDto } from '../admin/dto/create-chef.dto';
import { AdminService } from '../admin/admin.service';
import { UserService } from '../user/user.service';
import { UserProfileDto } from '../user/dto/user.profile.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SavefulPreferencesDto } from './dto/saveful-preferences.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiJwtAuth, ApiJwtRoles } from 'src/common/swagger/api-auth.decorators';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  
  constructor(
    private readonly authservice: AuthService,
    private readonly adminService: AdminService,
    private readonly userService: UserService,
  ) {}

  @Post('request-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3600 } }) // 10 requests per hour per IP
  @ApiOperation({
    summary: 'Request signup OTP',
    description:
      'Public, rate-limited (10/hour per IP). Starts email signup: requires name, email, password, and confirmPassword, plus optional country and dietary fields. Emails a 6-digit OTP and stores pending signup data. Returns success, a message, and expiresIn. Fails if the email is already registered or passwords do not match.',
  })
  @ApiCreatedResponse({
    description:
      'OTP queued. Body: `{ success, message, expiresIn }` (typically 10 minutes).',
  })
  async requestOTP(@Body() dto: RequestOtpDto) {
    this.logger.log(`🔷 POST /auth/request-otp - Email: ${dto.email}`);
    try {
      const result = await this.authservice.requestOTP(dto);
      this.logger.log(`✅ OTP request successful for ${dto.email}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ OTP request failed for ${dto.email}: ${error.message}`);
      throw error;
    }
  }

  @Post('verify-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 3600 } }) // 20 attempts per hour per IP
  @ApiOperation({
    summary: 'Verify signup OTP',
    description:
      'Public, rate-limited (20/hour per IP). Body: email and 6-digit otp from request-otp. Creates the user from pending signup data, starts a session, and returns accessToken, refreshToken, and user. Use the access token as Bearer JWT for authenticated routes.',
  })
  @ApiCreatedResponse({
    description:
      'Account created and signed in. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async verifyOTP(@Body() dto: VerifyOtpDto) {
    return this.authservice.verifyOTP(dto);
  }

  @Post('')
  @ApiOperation({
    summary: 'Register user (legacy)',
    description:
      'Public. Creates a user immediately from RegisterUserDto (email, name, password, optional role/country/dietary fields) without OTP. Prefer request-otp + verify-otp for new clients. Returns accessToken, refreshToken, and user.',
  })
  @ApiCreatedResponse({
    description:
      'User created and signed in. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async register(@Body('') dto: RegisterUserDto) {
    return this.authservice.register(dto);
  }

  @Post('signup')
  @ApiOperation({
    summary: 'Sign up user',
    description:
      'Public alias of POST /auth. Same RegisterUserDto body and same immediate-create behaviour (no OTP). Returns accessToken, refreshToken, and user. New apps should use request-otp / verify-otp instead.',
  })
  @ApiCreatedResponse({
    description:
      'User created and signed in. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async signup(@Body('') dto: RegisterUserDto) {
    return this.authservice.register(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Public. Body: email and password (UserLoginDto). Any role (user, chef, admin) may use this route. Returns accessToken, refreshToken, and a user summary. Use admin/login or chef/login when the client must reject the other roles.',
  })
  @ApiCreatedResponse({
    description:
      'Login succeeded. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async Login(@Body('') dto: UserLoginDto) {
    return this.authservice.login(dto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Public. Body: `{ refreshToken }` from login, signup, or OTP verify. Rotates the session and returns a new accessToken and refreshToken. Fails with 401 if the token is missing, expired, not a refresh token, or the session is gone.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: {
          type: 'string',
          description: 'Refresh token returned from login, signup, or OTP verify.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'New token pair. Body: `{ success, accessToken, refreshToken }`.',
  })
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authservice.refreshToken(refreshToken);
  }

  @Post('admin/login')
  @ApiOperation({
    summary: 'Admin login',
    description:
      'Public. Same email/password body as login, but the account must have the admin role. Returns accessToken, refreshToken, and user. Use this token on Admin-tagged routes.',
  })
  @ApiCreatedResponse({
    description:
      'Admin session created. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async adminLogin(@Body('') dto: UserLoginDto) {
    return this.authservice.loginWithRole(dto, UserRole.ADMIN);
  }

  @Post('chef/login')
  @ApiOperation({
    summary: 'Chef login',
    description:
      'Public. Same email/password body as login, but the account must have the chef role. Returns accessToken, refreshToken, and user for chef CMS clients.',
  })
  @ApiCreatedResponse({
    description:
      'Chef session created. Body: `{ success, message, accessToken, refreshToken, user }`.',
  })
  async chefLogin(@Body('') dto: UserLoginDto) {
    return this.authservice.loginWithRole(dto, UserRole.CHEF);
  }

  @Post('chef/create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Only an admin can create chef accounts.')
  @ApiOperation({
    summary: 'Create chef account',
    description:
      'Admin JWT required. Body: CreateChefDto (email, name, password). Creates a chef user and a draft chef profile. Returns the new chef summary. Fails if the email is already registered.',
  })
  @ApiCreatedResponse({
    description:
      'Chef created. Body: `{ success, message, chef: { id, email, name, role, createdAt, updatedAt } }`.',
  })
  async createChef(@Body() dto: CreateChefDto) {
    return this.adminService.createChef(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get current auth profile',
    description:
      'Any authenticated user (JWT). Returns the caller’s profile: identity, dietary flags, savefulPreferences, and marketing opt-in (isUserSubscribed). Used by the app after login and on settings screens.',
  })
  @ApiOkResponse({
    description:
      'Profile object including id, email, name, dietary fields, savefulPreferences, and isUserSubscribed.',
  })
  async getProfile(@GetUser() user:any) {
    return this.authservice.getProfile(user.userId);
    
  }

  @Put('dietary-profile')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Update dietary profile',
    description:
      'Authenticated user (JWT). Body: UserProfileDto — vegType, allergy flags, country, timezone, household counts, pincode. Completing country here marks onboarding complete. Returns the updated user document.',
  })
  @ApiOkResponse({ description: 'Updated user document including dietaryProfile.' })
  async updateDietaryProfile(@Body() dto: UserProfileDto, @GetUser() user: any) {
    return this.userService.updateProfile(dto, user.userId);
  }

  @Put('saveful-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Update Saveful preferences',
    description:
      'Authenticated user (JWT). Body: SavefulPreferencesDto — optional focusAreas, cadence, selectedExperience, weeklySurveyDay. Persists preferences and returns the full auth profile (same shape as GET /auth/me).',
  })
  @ApiOkResponse({ description: 'Full auth profile after preferences were saved.' })
  async updateSavefulPreferences(
    @Body() dto: SavefulPreferencesDto,
    @GetUser() user: any,
  ) {
    return this.authservice.updateSavefulPreferences(user.userId, dto);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Update display profile',
    description:
      'Authenticated user (JWT). Body: UpdateProfileDto — optional name or first_name/last_name, phone_number, gender. Does not change dietary fields (use PUT /auth/dietary-profile). Returns the full auth profile.',
  })
  @ApiOkResponse({ description: 'Full auth profile after the display fields were updated.' })
  async updateProfile(@Body() dto: UpdateProfileDto, @GetUser() user: any) {
    return this.authservice.updateProfile(user.userId, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Change password',
    description:
      'Authenticated user (JWT). Body: currentPassword, newPassword, confirmNewPassword. newPassword must match confirmNewPassword. Returns `{ success, message }`.',
  })
  @ApiCreatedResponse({
    description: '`{ success: true, message: "Password updated successfully" }`.',
  })
  async changePassword(@Body() dto: ChangePasswordDto, @GetUser() user: any) {
    return this.authservice.changePassword(user.userId, dto);
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Delete own account',
    description:
      'Authenticated user (JWT). Permanently deletes the caller’s account, invalidates all sessions, and queues a confirmation email. Returns `{ success, message }`. This cannot be undone.',
  })
  @ApiOkResponse({
    description: '`{ success: true, message: "Account deleted successfully" }`.',
  })
  async deleteAccount(@GetUser() user: any) {
    return this.authservice.deleteAccount(user.userId);
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3600 } }) // 5 requests per hour per IP
  @ApiOperation({
    summary: 'Request password reset OTP',
    description:
      'Public, rate-limited (5/hour per IP). Body: `{ email }`. Sends a reset OTP to a USER-role account. Returns a generic success message. Non-user roles and unknown emails receive the same client-facing error to avoid account enumeration where possible.',
  })
  @ApiCreatedResponse({
    description:
      '`{ success: true, message }` when a reset code was queued for a user account.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.logger.log(`🔑 POST /auth/forgot-password - Email: ${dto.email}`);
    return this.authservice.forgotPassword(dto);
  }

  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3600 } }) // 10 attempts per hour per IP
  @ApiOperation({
    summary: 'Reset password with OTP',
    description:
      'Public, rate-limited (10/hour per IP). Body: email, 6-digit otp from forgot-password, newPassword, and confirmPassword. Invalidates all existing sessions. Returns `{ success, message }` so the user can log in with the new password.',
  })
  @ApiCreatedResponse({
    description:
      '`{ success: true, message: "Password reset successfully. Please log in with your new password." }`.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    this.logger.log(`🔑 POST /auth/reset-password`);
    return this.authservice.resetPassword(dto);
  }

  /**
   * Returns a derived onboarding record for the authenticated user.
   * Onboarding is considered complete once the user has a country set
   * (written by PUT /auth/dietary-profile at the end of the onboarding carousel).
   * Returns { onboarding: null } when not yet complete.
   */
  @Get('onboarding')
  @UseGuards(JwtAuthGuard)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Get onboarding status',
    description:
      'Authenticated user (JWT). Returns a derived onboarding record once country is set (via PUT /auth/dietary-profile). Returns `{ onboarding: null }` when onboarding is not complete. Used by the app to skip or resume the carousel.',
  })
  @ApiOkResponse({
    description:
      '`{ onboarding }` with suburb, postcode, and household counts, or `{ onboarding: null }`.',
  })
  async getOnboarding(@GetUser() user: any) {
    return this.authservice.getOnboarding(user.userId);
  }
}
