import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { ApiJwtRoles } from '../../common/swagger/api-auth.decorators';
import { ReferralChefService } from './referral-chef.service';

@ApiTags('Chef Referrals')
@Controller('chef/referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CHEF)
@ApiJwtRoles()
export class ChefReferralsController {
  constructor(private readonly chefService: ReferralChefService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'My referral link, funnel and earnings',
    description:
      'Chef portal summary: referral link and code (created on first visit for approved chefs), aggregate counts, and PRODUCTION commission balances by status and currency. No subscriber details.',
  })
  @ApiOkResponse({ description: 'Referral summary for the authenticated chef.' })
  summary(@GetUser() user: any) {
    return this.chefService.summary(user.userId);
  }

  @Get('statements')
  @ApiOperation({
    summary: 'My quarterly referral payouts',
    description: 'Quarterly payouts with totals per currency and payment status.',
  })
  statements(@GetUser() user: any) {
    return this.chefService.statements(user.userId);
  }
}
