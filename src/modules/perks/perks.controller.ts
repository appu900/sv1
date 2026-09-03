import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/Get.user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiJwtAuth } from '../../common/swagger/api-auth.decorators';
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

@ApiTags('Perks')
@ApiJwtAuth()
@Controller('perks')
@UseGuards(JwtAuthGuard)
export class PerksController {
  constructor(private readonly perksService: PerksService) {}

  @Get('membership/status')
  @ApiOperation({
    summary: 'Get Perks membership status',
    description:
      'Returns whether the authenticated user has an active Perks membership, plus plan, renewal, and cancellation state.',
  })
  @ApiOkResponse({ description: 'Membership status payload.' })
  async getMembershipStatus(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getMembershipStatus(user.userId),
    );
  }

  @Post('membership/ensure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ensure a Perks membership record exists',
    description:
      'Idempotently creates a local Perks membership shell for the user if missing. Does not charge — use billing checkout to pay.',
  })
  @ApiOkResponse({ description: 'Membership record ensured.' })
  async ensureMembership(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.ensureMembership(user.userId));
  }

  @Post('membership/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel Perks membership',
    description:
      'Schedules cancellation of the user’s Perks membership. Optional `reason` is stored for analytics. Access typically continues until the end of the paid period.',
  })
  @ApiBody({ type: CancelPerksMembershipDto })
  @ApiOkResponse({ description: 'Cancellation scheduled.' })
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
  @ApiOperation({
    summary: 'Resume a cancelled Perks membership',
    description:
      'Reverses a pending cancellation so the membership renews as usual.',
  })
  @ApiOkResponse({ description: 'Membership resumed.' })
  async resumeMembership(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.resumeMembership(user.userId));
  }

  @Get('membership/events')
  @ApiOperation({
    summary: 'List membership billing events',
    description:
      'Returns recent membership lifecycle events (activated, cancelled, resumed, payment failed). `limit` defaults to 50 (1–200).',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Max events (1–200). Defaults to 50.' })
  @ApiOkResponse({ description: 'Membership event list.' })
  async getMembershipEvents(
    @GetUser() user: { userId: string },
    @Query() query: PerksMembershipEventsQueryDto,
  ) {
    return this.success(
      await this.perksService.listMembershipEvents(user.userId, query.limit),
    );
  }

  @Get('ecards')
  @ApiOperation({
    summary: 'List the user’s purchased e-cards',
    description:
      'Returns e-cards the member already owns (purchased for themselves), distinct from the catalogue browse list.',
  })
  @ApiOkResponse({ description: 'Owned e-cards.' })
  async getEcards(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getEcards(user.userId));
  }

  @Get('catalogue')
  @ApiOperation({
    summary: 'Browse the Perks e-card catalogue',
    description:
      'WeMAD gift-card catalogue. Filter with `q` (search), `category`, `featured`, and `sort` (`name` | `discount-desc` | `discount-asc`).',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search query (max 100 chars).' })
  @ApiQuery({ name: 'category', required: false, description: 'WeMAD category id or slug.' })
  @ApiQuery({ name: 'sort', required: false, description: 'name | discount-desc | discount-asc' })
  @ApiQuery({ name: 'featured', required: false, description: 'If true, only featured cards.' })
  @ApiOkResponse({ description: 'Catalogue listings.' })
  async getCatalogue(@Query() query: PerksCatalogueQueryDto) {
    return this.success(await this.perksService.getCatalogue(query));
  }

  /** Real WeMAD category tree — replaces the app's hardcoded guesswork. */
  @Get('categories')
  @ApiOperation({
    summary: 'Get the WeMAD category tree',
    description:
      'Returns the live WeMAD category tree used to power catalogue filters. Prefer this over any hardcoded category list in the app.',
  })
  @ApiOkResponse({ description: 'Category tree.' })
  async getCategories() {
    return this.success(await this.perksService.getCategories());
  }

  @Get('catalogue/:ecardId')
  @ApiOperation({
    summary: 'Get one catalogue e-card',
    description:
      'Returns a single WeMAD e-card by numeric `ecardId`, including denominations and gift options.',
  })
  @ApiParam({ name: 'ecardId', description: 'Numeric WeMAD e-card id.' })
  @ApiOkResponse({ description: 'Catalogue card detail.' })
  async getCatalogueCard(@Param('ecardId') ecardId: string) {
    return this.success(await this.perksService.getCatalogueCard(ecardId));
  }

  @Get('gift-options')
  @ApiOperation({
    summary: 'Get gift templates for an e-card',
    description:
      'Returns WeMAD gift templates and designs available for the given `ecardId`. Required before adding a gift line to the cart.',
  })
  @ApiQuery({ name: 'ecardId', required: false, description: 'Numeric WeMAD e-card id.' })
  @ApiOkResponse({ description: 'Gift template options.' })
  async getGiftOptions(
    @GetUser() user: { userId: string },
    @Query() query: PerksGiftOptionsQueryDto,
  ) {
    return this.success(
      await this.perksService.getGiftOptions(user.userId, query.ecardId),
    );
  }

  @Get('favourites')
  @ApiOperation({
    summary: 'List favourite e-cards',
    description:
      'Returns the authenticated user’s favourited catalogue e-cards.',
  })
  @ApiOkResponse({ description: 'Favourite e-cards.' })
  async getFavourites(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getFavourites(user.userId));
  }

  @Post('favourites')
  @ApiOperation({
    summary: 'Add an e-card to favourites',
    description:
      'Favourites a catalogue card. Body: `{ ecardId }` (numeric WeMAD id).',
  })
  @ApiBody({ type: AddPerksFavouriteDto })
  @ApiCreatedResponse({ description: 'Favourite added.' })
  async addFavourite(
    @GetUser() user: { userId: string },
    @Body() dto: AddPerksFavouriteDto,
  ) {
    return this.success(await this.perksService.addFavourite(user.userId, dto));
  }

  @Delete('favourites/:ecardId')
  @ApiOperation({
    summary: 'Remove an e-card from favourites',
    description:
      'Removes the given WeMAD e-card from the user’s favourites.',
  })
  @ApiParam({ name: 'ecardId', description: 'Numeric WeMAD e-card id.' })
  @ApiOkResponse({ description: 'Favourite removed.' })
  async removeFavourite(
    @GetUser() user: { userId: string },
    @Param('ecardId') ecardId: string,
  ) {
    return this.success(
      await this.perksService.removeFavourite(user.userId, ecardId),
    );
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get the Perks dashboard',
    description:
      'Combined membership, wallet, featured catalogue, and savings snapshot for the Perks home screen.',
  })
  @ApiOkResponse({ description: 'Perks dashboard payload.' })
  async getDashboard(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getDashboard(user.userId));
  }

  @Get('cart')
  @ApiOperation({
    summary: 'Get the Perks cart',
    description:
      'Returns the user’s current WeMAD cart lines (denomination, quantity, gift fields).',
  })
  @ApiOkResponse({ description: 'Cart contents.' })
  async getCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.getCart(user.userId));
  }

  @Post('cart/items')
  @ApiOperation({
    summary: 'Add an item to the Perks cart',
    description:
      'Adds an e-card line: `ecardId`, `ecardValue`, `quantity`. For gifts also send recipient name/email/phone plus `giftTemplateId` and `giftTemplateDesignId` (WeMAD requires all three).',
  })
  @ApiBody({ type: PerksCartItemDto })
  @ApiCreatedResponse({ description: 'Cart line added.' })
  async addCartItem(
    @GetUser() user: { userId: string },
    @Body() dto: PerksCartItemDto,
  ) {
    return this.success(await this.perksService.addCartItem(user.userId, dto));
  }

  @Patch('cart/items/:itemId')
  @ApiOperation({
    summary: 'Update a Perks cart line',
    description:
      'Updates quantity and/or denomination (`ecardValue`) on an existing cart line.',
  })
  @ApiParam({ name: 'itemId', description: 'Cart line id.' })
  @ApiBody({ type: UpdatePerksCartItemDto })
  @ApiOkResponse({ description: 'Cart line updated.' })
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
  @ApiOperation({
    summary: 'Remove a Perks cart line',
    description:
      'Deletes one line from the user’s cart.',
  })
  @ApiParam({ name: 'itemId', description: 'Cart line id.' })
  @ApiOkResponse({ description: 'Cart line removed.' })
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
  @ApiOperation({
    summary: 'Quote the current cart',
    description:
      'Asks WeMAD for a live price on every line in the user’s cart (discounts, fees, gift charges) without starting checkout.',
  })
  @ApiOkResponse({ description: 'Cart quote.' })
  async quoteCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.quoteCart(user.userId));
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quote a single e-card line',
    description:
      'Price a one-off line (`ecardId`, `ecardValue`, `quantity`, optional gift fields) without adding it to the cart. Used by the product detail “what will this cost?” step.',
  })
  @ApiBody({ type: QuotePerksDto })
  @ApiOkResponse({ description: 'Single-line quote.' })
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
  @ApiOperation({
    summary: 'Start WeMAD hosted checkout for the cart',
    description:
      'Returns a hosted-checkout redirect URL. WeMAD owns payment and e-card issuance — nothing is created on the Saveful side, so no idempotency key is required. Open the URL in a browser / webview.',
  })
  @ApiOkResponse({ description: 'Hosted checkout redirect.' })
  async checkoutCart(@GetUser() user: { userId: string }) {
    return this.success(await this.perksService.checkoutCart(user.userId));
  }

  @Get('orders')
  @ApiOperation({
    summary: 'List Perks orders',
    description:
      'Paged order history for the authenticated member. `limit` defaults to 20 (1–100); `offset` defaults to 0.',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100). Defaults to 20.' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset. Defaults to 0.' })
  @ApiOkResponse({ description: 'Order list.' })
  async listOrders(
    @GetUser() user: { userId: string },
    @Query() query: PerksOrderListQueryDto,
  ) {
    return this.success(await this.perksService.listOrders(user.userId, query));
  }

  @Get('orders/:orderNumber')
  @ApiOperation({
    summary: 'Get a Perks order',
    description:
      'Returns one order owned by the member, including line items and fulfilment status.',
  })
  @ApiParam({ name: 'orderNumber', description: 'WeMAD / Saveful order number.' })
  @ApiOkResponse({ description: 'Order detail.' })
  async getOrder(
    @GetUser() user: { userId: string },
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.success(
      await this.perksService.getOrder(user.userId, orderNumber),
    );
  }

  @Get('orders/:orderNumber/tax-receipt')
  @ApiOperation({
    summary: 'Get a Perks order tax receipt',
    description:
      'Returns the tax receipt (or a URL to it) for an order owned by the member.',
  })
  @ApiParam({ name: 'orderNumber', description: 'WeMAD / Saveful order number.' })
  @ApiOkResponse({ description: 'Tax receipt payload.' })
  async getTaxReceipt(
    @GetUser() user: { userId: string },
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.success(
      await this.perksService.getTaxReceipt(user.userId, orderNumber),
    );
  }

  @Get('wallet')
  @ApiOperation({
    summary: 'Get the Perks wallet',
    description:
      'Returns the member’s purchased e-cards. Query `state` is `active` (default) or `archived`. Does not include cards the user gifted away — use `/wallet/gifted` for those.',
  })
  @ApiQuery({ name: 'state', required: false, description: 'active (default) or archived.' })
  @ApiOkResponse({ description: 'Wallet cards.' })
  async getWallet(
    @GetUser() user: { userId: string },
    @Query() query: PerksWalletQueryDto,
  ) {
    return this.success(
      await this.perksService.getWallet(user.userId, false, query.state),
    );
  }

  @Get('wallet/gifted')
  @ApiOperation({
    summary: 'Get gifted wallet cards',
    description:
      'Returns e-cards the member purchased as gifts for someone else. `state` is `active` (default) or `archived`.',
  })
  @ApiQuery({ name: 'state', required: false, description: 'active (default) or archived.' })
  @ApiOkResponse({ description: 'Gifted wallet cards.' })
  async getGiftedWallet(
    @GetUser() user: { userId: string },
    @Query() query: PerksWalletQueryDto,
  ) {
    return this.success(
      await this.perksService.getWallet(user.userId, true, query.state),
    );
  }

  @Get('wallet/archived')
  @ApiOperation({
    summary: 'Get archived wallet cards',
    description:
      'Convenience alias for `GET /perks/wallet?state=archived` for cards the member kept (not gifted).',
  })
  @ApiOkResponse({ description: 'Archived wallet cards.' })
  async getArchivedWallet(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getWallet(user.userId, false, 'archived'),
    );
  }

  @Get('wallet/cards/:cardKey')
  @ApiOperation({
    summary: 'Get one wallet card',
    description:
      'Returns a single wallet card by `cardKey` (code, pin, balance, and gift metadata).',
  })
  @ApiParam({ name: 'cardKey', description: 'Wallet card key.' })
  @ApiOkResponse({ description: 'Wallet card detail.' })
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
  @ApiOperation({
    summary: 'Archive a wallet card',
    description:
      'Hides the card from the active wallet without deleting it. Restore with `/unarchive`.',
  })
  @ApiParam({ name: 'cardKey', description: 'Wallet card key.' })
  @ApiOkResponse({ description: 'Card archived.' })
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
  @ApiOperation({
    summary: 'Unarchive a wallet card',
    description:
      'Moves an archived card back into the active wallet.',
  })
  @ApiParam({ name: 'cardKey', description: 'Wallet card key.' })
  @ApiOkResponse({ description: 'Card unarchived.' })
  async unarchiveWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.setWalletArchived(user.userId, cardKey, false),
    );
  }

  @Delete('wallet/cards/:cardKey')
  @ApiOperation({
    summary: 'Hide a wallet card',
    description:
      'Soft-hides the card from the wallet UI. Distinct from archive — used when the user wants the card gone from both active and archived lists.',
  })
  @ApiParam({ name: 'cardKey', description: 'Wallet card key.' })
  @ApiOkResponse({ description: 'Card hidden.' })
  async hideWalletCard(
    @GetUser() user: { userId: string },
    @Param('cardKey') cardKey: string,
  ) {
    return this.success(
      await this.perksService.hideWalletCard(user.userId, cardKey),
    );
  }

  @Get('calculator/categories')
  @ApiOperation({
    summary: 'Get savings-calculator categories',
    description:
      'Returns the spend categories the Perks savings calculator accepts (groceries, fuel, etc.).',
  })
  @ApiOkResponse({ description: 'Calculator category list.' })
  getCalculatorCategories() {
    return this.success(this.perksService.getCalculatorCategories());
  }

  @Get('calculator/latest')
  @ApiOperation({
    summary: 'Get the latest savings calculation',
    description:
      'Returns the most recent calculator result saved for the authenticated user, or empty when they have never calculated.',
  })
  @ApiOkResponse({ description: 'Latest calculation.' })
  async getLatestCalculation(@GetUser() user: { userId: string }) {
    return this.success(
      await this.perksService.getLatestCalculation(user.userId),
    );
  }

  @Post('calculator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run and save a savings calculation',
    description:
      'Accepts spend line items (`category`, `amount`, `frequency` of weekly | monthly | annually), computes estimated Perks savings, and persists the result as the user’s latest calculation.',
  })
  @ApiBody({ type: CalculatePerksDto })
  @ApiOkResponse({ description: 'Calculation result.' })
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
