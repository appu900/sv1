import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { InventoryAiService } from './inventory-ai.service';
import {
  KitchenScanUsageService,
} from './kitchen-scan-usage.service';
import { AddInventoryItemDto } from './dto/add-inventory-item.dto';
import { BatchAddInventoryItemsDto } from './dto/batch-add-inventory-items.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { DiscardInventoryItemDto } from './dto/discard-inventory-item.dto';
import { ConsumeInventoryItemsDto } from './dto/consume-inventory-items.dto';
import { VoiceAddInventoryDto } from './dto/voice-add-inventory.dto';
import { ScanShoppingListDto } from './dto/scan-shopping-list.dto';
import {
  GetInventoryQueryDto,
  WasteClassifyDto,
} from './dto/get-inventory-query.dto';
import { EstimateShelfLifeDto, LeftoverMakeoverDto } from './dto/leftover-ai.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { InventoryItemSource } from '../../database/schemas/user-inventory.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import { ApiJwtAuth, ApiJwtRoles } from '../../common/swagger/api-auth.decorators';

@ApiTags('Inventory')
@ApiJwtAuth()
@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly inventoryAiService: InventoryAiService,
    private readonly kitchenScanUsage: KitchenScanUsageService,
    private readonly subscriptionService: SubscriptionService,
  ) {}


  @Get()
  @ApiOperation({
    summary: 'List the current user’s inventory',
    description:
      'Returns active kitchen inventory items for the authenticated user. Filter with `storageLocation` (pantry | fridge | freezer | other), `freshnessStatus` (fresh | expiring_soon | expired), `search`, and `expiringWithinDays`.',
  })
  @ApiQuery({ name: 'storageLocation', required: false, description: 'pantry | fridge | freezer | other' })
  @ApiQuery({ name: 'freshnessStatus', required: false, description: 'fresh | expiring_soon | expired' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive name search.' })
  @ApiQuery({ name: 'expiringWithinDays', required: false, description: 'Only items expiring within this many days.' })
  @ApiOkResponse({ description: 'Inventory items matching the filters.' })
  async getInventory(@Request() req, @Query() query: GetInventoryQueryDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching inventory for user ${userId}`);
    return this.inventoryService.getInventory(userId, query);
  }

  @Get('grouped')
  @ApiOperation({
    summary: 'List inventory grouped by storage',
    description:
      'Returns the user’s active items grouped by storage location (pantry, fridge, freezer, other) for the kitchen overview.',
  })
  @ApiOkResponse({ description: 'Inventory grouped by storage location.' })
  async getInventoryGrouped(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching grouped inventory for user ${userId}`);
    return this.inventoryService.getInventoryGroupedByStorage(userId);
  }

  @Get('expiring')
  @ApiOperation({
    summary: 'List items expiring soon',
    description:
      'Returns items that expire within `days` (default 3). Used by expiry alerts and the “use first” list.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Look-ahead window in days. Defaults to 3.',
  })
  @ApiOkResponse({ description: 'Items expiring within the window.' })
  async getExpiringItems(
    @Request() req,
    @Query('days') days?: number,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching expiring items for user ${userId}`);
    return this.inventoryService.getExpiringItems(userId, days || 3);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Get AI meal suggestions from inventory',
    description:
      'AI-ranked recipes the user can cook from current inventory. Optional `country` scopes the catalog; `limit` defaults to 10.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code for recipe catalog scope.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max suggestions. Defaults to 10.' })
  @ApiOkResponse({ description: 'Ranked meal suggestions.' })
  async getMealSuggestions(
    @Request() req,
    @Query('country') country?: string,
    @Query('limit') limit?: number,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching meal suggestions for user ${userId}`);
    return this.inventoryAiService.getMealSuggestions(
      userId,
      country,
      limit || 10,
    );
  }

  @Get('suggestions/quick')
  @ApiOperation({
    summary: 'Get quick meal suggestions',
    description:
      'Faster suggestion set than `/suggestions`. Optionally restrict to recipes that use a specific `ingredientId`. `limit` defaults to 10.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code for recipe catalog scope.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max suggestions. Defaults to 10.' })
  @ApiQuery({ name: 'ingredientId', required: false, description: 'Only recipes that use this ingredient.' })
  @ApiOkResponse({ description: 'Quick meal suggestions.' })
  async getMealSuggestionsQuick(
    @Request() req,
    @Query('country') country?: string,
    @Query('limit') limit?: number,
    @Query('ingredientId') ingredientId?: string,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Fetching quick meal suggestions for user ${userId}${
        ingredientId ? ` (ingredient filter: ${ingredientId})` : ''
      }`,
    );
    return this.inventoryAiService.getMealSuggestionsQuick(
      userId,
      country,
      limit || 10,
      ingredientId,
    );
  }

  @Post('suggestions/notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check for new recipe matches after inventory change',
    description:
      'Compares current inventory to recently added items and returns whether new cookable recipes appeared. Used after add/voice-confirm to drive an in-app prompt.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code for recipe catalog scope.' })
  @ApiOkResponse({ description: 'New-match flags and up to 3 top matches.' })
  async checkNewRecipeMatches(
    @Request() req,
    @Query('country') country?: string,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Checking new recipe matches for user ${userId}`);
    const newMatches =
      await this.inventoryAiService.getNewMatchesAfterInventoryChange(
        userId,
        country,
      );
    return {
      hasNewMatches: newMatches.length > 0,
      newMatchCount: newMatches.length,
      topNewMatch: newMatches[0] || null,
      newMatches: newMatches.slice(0, 3),
    };
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Get personal waste analytics',
    description:
      'Returns the authenticated user’s waste / discard analytics (discarded items, waste type mix, and savings impact).',
  })
  @ApiOkResponse({ description: 'Personal waste analytics.' })
  async getWasteAnalytics(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching waste analytics for user ${userId}`);
    return this.inventoryService.getWasteAnalytics(userId);
  }

  @Get('staples/out-of-stock')
  @ApiOperation({
    summary: 'List out-of-stock staples',
    description:
      'Returns staple ingredients the user usually keeps that are currently missing from inventory, for restock prompts.',
  })
  @ApiOkResponse({ description: 'Out-of-stock staple items.' })
  async getOutOfStockStaples(@Request() req) {
    const userId = req.user._id || req.user.userId;
    return this.inventoryService.getOutOfStockStaples(userId);
  }


  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add one inventory item',
    description:
      'Adds a single pantry/fridge item. Enforces the plan’s live ingredient quota and returns `{ item, quota }`.',
  })
  @ApiBody({ type: AddInventoryItemDto })
  @ApiCreatedResponse({ description: 'Item added with quota info.' })
  async addItem(@Request() req, @Body() dto: AddInventoryItemDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Adding inventory item for user ${userId}`);
    const current = await this.inventoryService.countActiveItems(userId);
    const quota = await this.subscriptionService.enforceLiveLimit(
      userId,
      'ingredients',
      current,
      1,
    );
    const item = await this.inventoryService.addItem(userId, dto);
    return { item, quota };
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add inventory items in batch',
    description:
      'Adds many items at once (after voice confirm or shopping-list confirm). Enforces the ingredient quota for the whole batch and returns `{ items, quota }`.',
  })
  @ApiBody({ type: BatchAddInventoryItemsDto })
  @ApiCreatedResponse({ description: 'Items added with quota info.' })
  async addBatch(@Request() req, @Body() dto: BatchAddInventoryItemsDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Batch adding ${dto.items.length} inventory items for user ${userId}`,
    );
    const current = await this.inventoryService.countActiveItems(userId);
    const quota = await this.subscriptionService.enforceLiveLimit(
      userId,
      'ingredients',
      current,
      dto.items.length,
    );
    const items = await this.inventoryService.addBatch(userId, dto);
    return { items, quota };
  }

  @Post('voice-add')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Parse a voice transcript into inventory items',
    description:
      'AI-parses `transcript` into proposed inventory items with expiry estimates. Does **not** persist — the client should review then call `POST /inventory/voice-confirm`. Optional `country` improves matching.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code for ingredient matching.' })
  @ApiBody({ type: VoiceAddInventoryDto })
  @ApiOkResponse({ description: 'Parsed items ready for confirmation.' })
  async voiceAdd(
    @Request() req,
    @Body() dto: VoiceAddInventoryDto,
    @Query('country') country?: string,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Voice-adding inventory items for user ${userId}: "${dto.transcript}"`,
    );

    const parsedItems = await this.inventoryAiService.parseVoiceTranscript(
      dto.transcript,
      country,
      userId,
    );

    return {
      transcript: dto.transcript,
      parsedItems: parsedItems.map((item) => ({
        ...item,
        expiresAt: new Date(
          Date.now() + item.expiryDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
        source: InventoryItemSource.VOICE,
      })),
    };
  }

  @Post('voice-confirm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirm voice-parsed inventory items',
    description:
      'Persists items previously returned by `POST /inventory/voice-add`. Sets source to VOICE, enforces the ingredient quota, and returns `{ items, quota }`.',
  })
  @ApiBody({ type: BatchAddInventoryItemsDto })
  @ApiCreatedResponse({ description: 'Voice items saved with quota info.' })
  async voiceConfirm(
    @Request() req,
    @Body() dto: BatchAddInventoryItemsDto,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Confirming ${dto.items.length} voice-parsed items for user ${userId}`,
    );

    const current = await this.inventoryService.countActiveItems(userId);
    const quota = await this.subscriptionService.enforceLiveLimit(
      userId,
      'ingredients',
      current,
      dto.items.length,
    );

    const itemsWithSource = {
      items: dto.items.map((item) => ({
        ...item,
        source: InventoryItemSource.VOICE,
      })),
    };

    const items = await this.inventoryService.addBatch(
      userId,
      itemsWithSource as any,
    );
    return { items, quota };
  }

  @Get('photos/scan-usage')
  @ApiOperation({
    summary: 'Get shopping-photo scan usage',
    description:
      'Returns this month’s kitchen-scan quota: count used, remaining, plan limit, and whether the user is on an unlimited plan.',
  })
  @ApiOkResponse({ description: 'Scan usage for the current billing period.' })
  async getShoppingListScanUsage(@Request() req) {
    const userId = req.user._id || req.user.userId;
    return this.kitchenScanUsage.getUsage(userId);
  }

  @Post('photos/scan-shopping-list')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor('images', 3, {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Scan shopping photos into inventory items',
    description:
      'Multipart AI scan of 1–3 shopping / receipt photos (field name `images`, max 8 MB each). Rate-limited to **3 requests per 60 seconds**. Consumes a monthly kitchen-scan slot; the slot is refunded if AI fails or finds nothing. Optional form field `country`. Returns parsed items plus updated usage — does not persist until the client batch-adds.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: '1–3 shopping or receipt photos (field name `images`).',
        },
        country: {
          type: 'string',
          description: 'Optional ISO country code for ingredient matching.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Parsed items and scan usage.' })
  async scanShoppingListPhotos(
    @Request() req,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: ScanShoppingListDto,
  ) {
    const userId = req.user._id || req.user.userId;
    const images = (files || []).filter(
      (f) => f && f.buffer && f.buffer.length > 0,
    );
    if (images.length === 0) {
      throw new BadRequestException(
        'Please attach 1-3 photos of your shopping.',
      );
    }
    if (images.length > 3) {
      throw new BadRequestException(
        'You can scan up to 3 photos per request.',
      );
    }

    const reservation = await this.kitchenScanUsage.reserve(userId);
    this.logger.log(
      `Scanning ${images.length} shopping-list photo(s) for user ${userId} (usage ${reservation.count}/${reservation.unlimited ? '∞' : reservation.limit} plan=${reservation.plan})`,
    );

    let parsedItems;
    try {
      parsedItems = await this.inventoryAiService.parseShoppingListPhotos(
        images.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })),
        dto.country,
        userId,
      );
    } catch (error: any) {
      // AI failed — refund the slot so the user's quota isn't burnt.
      await this.kitchenScanUsage.rollback(userId);
      this.logger.error(
        `scanShoppingListPhotos failed for user ${userId}: ${error?.message}`,
      );
      throw new BadRequestException(
        'We could not read your photos. Please try again with clearer pictures.',
      );
    }

    // If AI found nothing usable, refund the slot — no value was delivered.
    if (parsedItems.length === 0) {
      await this.kitchenScanUsage.rollback(userId);
      return {
        parsedItems: [],
        imagesProcessed: images.length,
        usage: await this.kitchenScanUsage.getUsage(userId),
      };
    }

    const now = Date.now();
    const remainingNum =
      typeof reservation.remaining === 'number' && Number.isFinite(reservation.remaining)
        ? reservation.remaining
        : null;
    return {
      parsedItems: parsedItems.map((item) => ({
        ...item,
        expiresAt:
          item.expiresAt ??
          new Date(
            now + item.expiryDays * 24 * 60 * 60 * 1000,
          ).toISOString(),
        source: InventoryItemSource.SHOPPING_LIST_PHOTO,
      })),
      imagesProcessed: images.length,
      usage: {
        count: reservation.count,
        remaining: reservation.unlimited ? null : remainingNum,
        limit: reservation.unlimited ? null : reservation.limit,
        unlimited: reservation.unlimited,
        plan: reservation.plan,
        warn: !reservation.unlimited && remainingNum !== null && remainingNum <= 1,
        warningMessage: reservation.unlimited
          ? undefined
          : remainingNum !== null && remainingNum <= 0
          ? 'This was your last photo scan this month. Upgrade to keep scanning.'
          : remainingNum !== null && remainingNum <= 1
          ? `Only ${remainingNum} photo scan left this month — upgrade to keep scanning.`
          : undefined,
      },
    };
  }

  @Post('from-shopping-list')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add shopping-list items into inventory',
    description:
      'Takes checked-off shopping-list lines, AI-parses them into inventory items (quantities, units, expiry), enforces quota, and persists with source SHOPPING_LIST.',
  })
  @ApiQuery({ name: 'country', required: false, description: 'ISO country code for ingredient matching.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'string' },
              unit: { type: 'string' },
              ingredientId: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Items added with quota info.' })
  async addFromShoppingList(
    @Request() req,
    @Body() dto: { items: { name: string; quantity?: string; unit?: string; ingredientId?: string }[] },
    @Query('country') country?: string,
  ) {
    const userId = req.user._id || req.user.userId;

    const transcript = dto.items
      .map((i) => `${i.quantity || '1'} ${i.unit || ''} ${i.name}`.trim().replace(/\s+/g, ' '))
      .join(', ');

    this.logger.log(
      `Adding ${dto.items.length} shopping-list items to inventory for user ${userId} via AI: "${transcript}"`,
    );

    const parsedItems = await this.inventoryAiService.parseVoiceTranscript(transcript, country, userId);
    const current = await this.inventoryService.countActiveItems(userId);
    const quota = await this.subscriptionService.enforceLiveLimit(
      userId,
      'ingredients',
      current,
      parsedItems.length,
    );

    const itemsWithSource = {
      items: parsedItems.map((parsed, idx) => ({
        ...parsed,
        ingredientId: parsed.ingredientId ?? dto.items[idx]?.ingredientId,
        expiresAt: new Date(Date.now() + parsed.expiryDays * 24 * 60 * 60 * 1000).toISOString(),
        source: InventoryItemSource.SHOPPING_LIST,
      })),
    };

    const items = await this.inventoryService.addBatch(userId, itemsWithSource as any);
    return { items, quota };
  }

  @Post('consume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consume inventory after cooking',
    description:
      'Decrements or removes inventory items used by a cooked recipe. Send the ingredient list and optional `recipeId`.',
  })
  @ApiBody({ type: ConsumeInventoryItemsDto })
  @ApiOkResponse({ description: 'Items consumed.' })
  async consumeItems(
    @Request() req,
    @Body() dto: ConsumeInventoryItemsDto,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Consuming ${dto.ingredients.length} ingredients for user ${userId} (recipe: ${dto.recipeId || 'unknown'})`,
    );
    return this.inventoryService.consumeItems(userId, dto);
  }


  @Get('admin/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin inventory overview',
    description:
      'Admin-only platform overview: total users with inventory, item counts, and high-level kitchen metrics.',
  })
  @ApiOkResponse({ description: 'Global inventory overview.' })
  async adminGetOverview() {
    this.logger.log('Admin: Fetching inventory overview');
    return this.inventoryService.adminGetInventoryOverview();
  }

  @Get('admin/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin global waste analytics',
    description:
      'Admin-only waste analytics rolled up across all users.',
  })
  @ApiOkResponse({ description: 'Global waste analytics.' })
  async adminGetGlobalAnalytics() {
    this.logger.log('Admin: Fetching global waste analytics');
    return this.inventoryService.adminGetGlobalWasteAnalytics();
  }

  @Get('admin/expiring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin global expiring items',
    description:
      'Admin-only list of items expiring across all users within `days` (default 3).',
  })
  @ApiQuery({ name: 'days', required: false, description: 'Look-ahead window in days. Defaults to 3.' })
  @ApiOkResponse({ description: 'Global expiring items.' })
  async adminGetGlobalExpiring(@Query('days') days?: number) {
    this.logger.log('Admin: Fetching global expiring items');
    return this.inventoryService.adminGetGlobalExpiringItems(days || 3);
  }

  @Get('admin/user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin: list a user’s inventory',
    description:
      'Admin-only. Same filters as `GET /inventory` (`storageLocation`, `freshnessStatus`, `search`, `expiringWithinDays`) for the given user.',
  })
  @ApiParam({ name: 'userId', description: 'Target user ObjectId.' })
  @ApiQuery({ name: 'storageLocation', required: false, description: 'pantry | fridge | freezer | other' })
  @ApiQuery({ name: 'freshnessStatus', required: false, description: 'fresh | expiring_soon | expired' })
  @ApiQuery({ name: 'search', required: false, description: 'Case-insensitive name search.' })
  @ApiQuery({ name: 'expiringWithinDays', required: false, description: 'Only items expiring within this many days.' })
  @ApiOkResponse({ description: 'That user’s inventory.' })
  async adminGetUserInventory(
    @Param('userId') userId: string,
    @Query() query: GetInventoryQueryDto,
  ) {
    this.logger.log(`Admin: Fetching inventory for user ${userId}`);
    return this.inventoryService.getInventory(userId, query);
  }

  @Get('admin/user/:userId/grouped')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin: grouped inventory for a user',
    description:
      'Admin-only. Returns the given user’s items grouped by storage location.',
  })
  @ApiParam({ name: 'userId', description: 'Target user ObjectId.' })
  @ApiOkResponse({ description: 'Grouped inventory for that user.' })
  async adminGetUserInventoryGrouped(@Param('userId') userId: string) {
    this.logger.log(`Admin: Fetching grouped inventory for user ${userId}`);
    return this.inventoryService.getInventoryGroupedByStorage(userId);
  }

  @Get('admin/user/:userId/expiring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin: expiring items for a user',
    description:
      'Admin-only. Items belonging to `userId` that expire within `days` (default 3).',
  })
  @ApiParam({ name: 'userId', description: 'Target user ObjectId.' })
  @ApiQuery({ name: 'days', required: false, description: 'Look-ahead window in days. Defaults to 3.' })
  @ApiOkResponse({ description: 'That user’s expiring items.' })
  async adminGetUserExpiring(
    @Param('userId') userId: string,
    @Query('days') days?: number,
  ) {
    this.logger.log(`Admin: Fetching expiring items for user ${userId}`);
    return this.inventoryService.getExpiringItems(userId, days || 3);
  }

  @Get('admin/user/:userId/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin: waste analytics for a user',
    description:
      'Admin-only waste / discard analytics for a single user.',
  })
  @ApiParam({ name: 'userId', description: 'Target user ObjectId.' })
  @ApiOkResponse({ description: 'That user’s waste analytics.' })
  async adminGetUserAnalytics(@Param('userId') userId: string) {
    this.logger.log(`Admin: Fetching waste analytics for user ${userId}`);
    return this.inventoryService.getWasteAnalytics(userId);
  }

  @Delete('admin/:itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiJwtRoles('Requires admin role.')
  @ApiOperation({
    summary: 'Admin: delete any inventory item',
    description:
      'Admin-only hard delete of an inventory item by id, regardless of owner. Returns 204.',
  })
  @ApiParam({ name: 'itemId', description: 'Inventory item ObjectId.' })
  @ApiOkResponse({ description: 'Item deleted (204 No Content).' })
  async adminDeleteItem(@Param('itemId') itemId: string) {
    this.logger.log(`Admin: Deleting inventory item ${itemId}`);
    await this.inventoryService.adminDeleteItem(itemId);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reorder inventory items',
    description:
      'Sets the display order of the user’s kitchen list. Send `itemIds` in the desired order.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        itemIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Inventory item ids in the desired display order.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Items reordered.' })
  async reorderItems(
    @Request() req,
    @Body() dto: { itemIds: string[] },
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Reordering ${dto.itemIds?.length ?? 0} inventory items for user ${userId}`);
    return this.inventoryService.reorderItems(userId, dto.itemIds || []);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an inventory item',
    description:
      'Partial update of an item owned by the authenticated user (quantity, unit, storage, expiry, name, etc.).',
  })
  @ApiParam({ name: 'id', description: 'Inventory item ObjectId.' })
  @ApiBody({ type: UpdateInventoryItemDto })
  @ApiOkResponse({ description: 'Updated inventory item.' })
  async updateItem(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Updating inventory item ${id} for user ${userId}`);
    return this.inventoryService.updateItem(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an inventory item',
    description:
      'Removes an item owned by the authenticated user. Returns 204 with no body.',
  })
  @ApiParam({ name: 'id', description: 'Inventory item ObjectId.' })
  @ApiOkResponse({ description: 'Item deleted (204 No Content).' })
  async deleteItem(@Request() req, @Param('id') id: string) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Deleting inventory item ${id} for user ${userId}`);
    await this.inventoryService.deleteItem(userId, id);
  }


  @Post('discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Discard an inventory item',
    description:
      'Marks an item as discarded (wasted) rather than consumed, recording reason / waste type for analytics.',
  })
  @ApiBody({ type: DiscardInventoryItemDto })
  @ApiOkResponse({ description: 'Item discarded.' })
  async discardItem(@Request() req, @Body() dto: DiscardInventoryItemDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Discarding inventory item ${dto.itemId} for user ${userId}`,
    );
    return this.inventoryService.discardItem(userId, dto);
  }

  @Post('waste-classify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Classify waste type for an ingredient',
    description:
      'AI classifies how an ingredient should be discarded (wet / dry / hazardous) given `ingredientName` and optional `packaging`. Used by the discard sheet.',
  })
  @ApiBody({ type: WasteClassifyDto })
  @ApiOkResponse({ description: 'Waste classification.' })
  async classifyWaste(@Request() req, @Body() dto: WasteClassifyDto) {
    const userId = req.user._id || req.user.userId;
    return this.inventoryAiService.classifyWaste(
      dto.ingredientName,
      dto.packaging,
      userId,
    );
  }

  @Post('leftover/shelf-life')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estimate leftover shelf life',
    description:
      'AI estimates how long a leftover dish keeps in the given `storageLocation` (and optional `dishCategory`). Used when adding leftovers to inventory.',
  })
  @ApiBody({ type: EstimateShelfLifeDto })
  @ApiOkResponse({ description: 'Estimated shelf life.' })
  async estimateShelfLife(@Request() req, @Body() dto: EstimateShelfLifeDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Estimating shelf life for "${dto.dishName}" in ${dto.storageLocation}`,
    );
    return this.inventoryAiService.estimateShelfLife(
      dto.dishName,
      dto.storageLocation,
      dto.dishCategory,
      userId,
    );
  }

  @Post('leftover/makeover-ideas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get leftover makeover ideas',
    description:
      'AI suggests recipes / reuse ideas for a leftover dish, scoped by `storageLocation` and optional `country`.',
  })
  @ApiBody({ type: LeftoverMakeoverDto })
  @ApiOkResponse({ description: 'Leftover makeover ideas.' })
  async getLeftoverMakeoverIdeas(@Request() req, @Body() dto: LeftoverMakeoverDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Generating makeover ideas for "${dto.dishName}"`);
    return this.inventoryAiService.getLeftoverMakeoverIdeas(
      dto.dishName,
      dto.storageLocation,
      dto.country,
      userId,
    );
  }
}
