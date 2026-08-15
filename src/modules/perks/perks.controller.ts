import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AddPerksFavouriteDto,
  CalculatePerksDto,
  CancelPerksMembershipDto,
  PerksCartItemDto,
  PerksCatalogueQueryDto,
  PerksGiftOptionsQueryDto,
  PerksMembershipEventsQueryDto,
  PerksOrderListQueryDto,
  PerksWalletQueryDto,
  QuotePerksDto,
  UpdatePerksCartItemDto,
} from './dto/perks.dto';
import { PerksService } from './perks.service';

@Controller('perks')
@UseGuards(JwtAuthGuard)
export class PerksController {
  constructor(private readonly perksService: PerksService) {}

  @Get('membership/status')
  async getMembershipStatus(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getMembershipStatus(user.userId),
    );
  }

  @Post('membership/ensure')
  @HttpCode(HttpStatus.OK)
  async ensureMembership(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.ensureMembership(user.userId));
  }

  @Post('membership/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelMembership(
    @GetUser() user: { userId: string },
    @Body() dto: CancelPerksMembershipDto,
  ) {
    return this.success(
      await this.perksService.cancelMembership(user.userId, dto),
    );
  }

  @Post('membership/resume')
  @HttpCode(HttpStatus.OK)
  async resumeMembership(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.resumeMembership(user.userId));
  }

  @Get('membership/events')
  async getMembershipEvents(
    @GetUser() user: { userId: string },
    @Query() query: PerksMembershipEventsQueryDto,
  ) {
    return this.success(
      await this.perksService.listMembershipEvents(user.userId, query.limit),
    );
  }

  @Get('ecards')
  async getEcards(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getEcards(user.userId));
  }

  @Get('catalogue')
  async getCatalogue(@Query() query: PerksCatalogueQueryDto) {
    return this.success(await this.perksService.getCatalogue(query));
  }

  /** Real WeMAD category tree — replaces the app's hardcoded guesswork. */
  @Get('categories')
  async getCategories() {
    return this.success(await this.perksService.getCategories());
  }

  @Get('catalogue/:ecardId')
  async getCatalogueCard(@Param('ecardId') ecardId: string) {
    return this.success(await this.perksService.getCatalogueCard(ecardId));
  }

  @Get('gift-options')
  async getGiftOptions(
    @GetUser() user: { userId: string },
    @Query() query: PerksGiftOptionsQueryDto,
  ) {
    return this.success(
      await this.perksService.getGiftOptions(user.userId, query.ecardId),
    );
  }

  @Get('favourites')
  async getFavourites(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getFavourites(user.userId));
  }

  @Post('favourites')
  async addFavourite(
    @GetUser() user: { userId: string },
    @Body() dto: AddPerksFavouriteDto,
  ) {
    return this.success(await this.perksService.addFavourite(user.userId, dto));
  }

  @Delete('favourites/:ecardId')
  async removeFavourite(
    @GetUser() user: { userId: string },
    @Param('ecardId') ecardId: string,
  ) {
    return this.success(
      await this.perksService.removeFavourite(user.userId, ecardId),
    );
  }

  @Get('dashboard')
  async getDashboard(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getDashboard(user.userId));
  }

  @Get('cart')
  async getCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getCart(user.userId));
  }

  @Post('cart/items')
  async addCartItem(
    @GetUser() user: { userId: string },
    @Body() dto: PerksCartItemDto,
  ) {
    return this.success(await this.perksService.addCartItem(user.userId, dto));
  }

  @Patch('cart/items/:itemId')
  async updateCartItem(
    @GetUser() user: { userId: string },
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePerksCartItemDto,
  ) {
    return this.success(
      await this.perksService.updateCartItem(user.userId, itemId, dto),
    );
  }

  @Delete('cart/items/:itemId')
  async deleteCartItem(
    @GetUser() user: { userId: string },
    @Param('itemId') itemId: string,
  ) {
    return this.success(
      await this.perksService.deleteCartItem(user.userId, itemId),
    );
  }

  @Post('cart/quote')
  @HttpCode(HttpStatus.OK)
  async quoteCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.quoteCart(user.userId));
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  async quote(@Body() dto: QuotePerksDto) {
    return this.success(await this.perksService.quote(dto));
  }

  /**
   * Returns a hosted-checkout redirect rather than an order: WeMAD owns
   * payment and issuance. No idempotency key is needed because nothing is
   * created on our side.
   */
  @Post('cart/checkout')
  @HttpCode(HttpStatus.OK)
  async checkoutCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.checkoutCart(user.userId));
  }

  @Get('orders')
  async listOrders(
    @GetUser() user: { userId: string },
    @Query() query: PerksOrderListQueryDto,
  ) {
    return this.success(await this.perksService.listOrders(user.userId, query));
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
  async getWallet(
    @GetUser() user: { userId: string },
    @Query() query: PerksWalletQueryDto,
  ) {
    return this.success(
      await this.perksService.getWallet(user.userId, false, query.state),
    );
  }

  @Get('wallet/gifted')
  async getGiftedWallet(
    @GetUser() user: { userId: string },
    @Query() query: PerksWalletQueryDto,
  ) {
    return this.success(
      await this.perksService.getWallet(user.userId, true, query.state),
    );
  }

  @Get('wallet/archived')
  async getArchivedWallet(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getWallet(user.userId, false, 'archived'),
    );
  }

  @Get('wallet/cards/:cardKey')
  async getWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.getWalletCard(user.userId, cardKey),
    );
  }

  @Post('wallet/cards/:cardKey/archive')
  @HttpCode(HttpStatus.OK)
  async archiveWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.setWalletArchived(user.userId, cardKey, true),
    );
  }

  @Post('wallet/cards/:cardKey/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchiveWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.setWalletArchived(user.userId, cardKey, false),
    );
  }

  @Delete('wallet/cards/:cardKey')
  async hideWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.hideWalletCard(user.userId, cardKey),
    );
  }

  @Get('calculator/categories')
  getCalculatorCategories() {
    return this.success(this.perksService.getCalculatorCategories());
  }

  @Get('calculator/latest')
  async getLatestCalculation(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getLatestCalculation(user.userId),
    );
  }

  @Post('calculator')
  @HttpCode(HttpStatus.OK)
  async calculate(
    @GetUser() user: { userId: string },
    @Body() dto: CalculatePerksDto,
  ) {
    return this.success(
      await this.perksService.calculateAndSave(user.userId, dto),
    );
  }

  private success<T>(data: T) {
    return { success: true, data };
  }
}
