import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CalculatePerksDto, CreatePerksOrderDto } from './dto/perks.dto';
import { PerksService } from './perks.service';

@Controller('perks')
@UseGuards(JwtAuthGuard)
export class PerksController {
  constructor(private readonly perksService: PerksService) {}

  @Post('membership/ensure')
  @HttpCode(HttpStatus.OK)
  async ensureMembership(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.ensureMembership(user.userId));
  }

  @Get('ecards')
  async getEcards(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getEcards(user.userId));
  }

  @Get('gift-options')
  async getGiftOptions(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getGiftOptions(user.userId));
  }

  @Post('orders')
  async createOrder(
    @GetUser() user: { userId: string },
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreatePerksOrderDto,
  ) {
    return this.success(
      await this.perksService.createOrder(user.userId, idempotencyKey, dto),
    );
  }

  @Get('orders/:orderNumber')
  async getOrder(
    @GetUser() user: { userId: string },
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.success(
      await this.perksService.getOrder(user.userId, orderNumber),
    );
  }

  @Post('orders/:orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @GetUser() user: { userId: string },
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.success(
      await this.perksService.cancelOrder(user.userId, orderNumber),
    );
  }

  @Get('orders/:orderNumber/tax-receipt')
  async getTaxReceipt(
    @GetUser() user: { userId: string },
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.success(
      await this.perksService.getTaxReceipt(user.userId, orderNumber),
    );
  }

  @Get('wallet')
  async getWallet(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getWallet(user.userId, false));
  }

  @Get('wallet/gifted')
  async getGiftedWallet(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getWallet(user.userId, true));
  }

  @Get('calculator/categories')
  getCalculatorCategories() {
    return this.success(this.perksService.getCalculatorCategories());
  }

  @Post('calculator')
  @HttpCode(HttpStatus.OK)
  calculate(@Body() dto: CalculatePerksDto) {
    return this.success(this.perksService.calculate(dto));
  }

  private success<T>(data: T) {
    return { success: true, data };
  }
}
