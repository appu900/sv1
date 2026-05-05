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
  async getInventory(@Request() req, @Query() query: GetInventoryQueryDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching inventory for user ${userId}`);
    return this.inventoryService.getInventory(userId, query);
  }

  @Get('grouped')
  async getInventoryGrouped(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching grouped inventory for user ${userId}`);
    return this.inventoryService.getInventoryGroupedByStorage(userId);
  }

  @Get('expiring')
  async getExpiringItems(
    @Request() req,
    @Query('days') days?: number,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching expiring items for user ${userId}`);
    return this.inventoryService.getExpiringItems(userId, days || 3);
  }

  @Get('suggestions')
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
  async getWasteAnalytics(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching waste analytics for user ${userId}`);
    return this.inventoryService.getWasteAnalytics(userId);
  }

  @Get('staples/out-of-stock')
  async getOutOfStockStaples(@Request() req) {
    const userId = req.user._id || req.user.userId;
    return this.inventoryService.getOutOfStockStaples(userId);
  }


  @Post()
  @HttpCode(HttpStatus.CREATED)
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
  async adminGetOverview() {
    this.logger.log('Admin: Fetching inventory overview');
    return this.inventoryService.adminGetInventoryOverview();
  }

  @Get('admin/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetGlobalAnalytics() {
    this.logger.log('Admin: Fetching global waste analytics');
    return this.inventoryService.adminGetGlobalWasteAnalytics();
  }

  @Get('admin/expiring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetGlobalExpiring(@Query('days') days?: number) {
    this.logger.log('Admin: Fetching global expiring items');
    return this.inventoryService.adminGetGlobalExpiringItems(days || 3);
  }

  @Get('admin/user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
  async adminGetUserInventoryGrouped(@Param('userId') userId: string) {
    this.logger.log(`Admin: Fetching grouped inventory for user ${userId}`);
    return this.inventoryService.getInventoryGroupedByStorage(userId);
  }

  @Get('admin/user/:userId/expiring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
  async adminGetUserAnalytics(@Param('userId') userId: string) {
    this.logger.log(`Admin: Fetching waste analytics for user ${userId}`);
    return this.inventoryService.getWasteAnalytics(userId);
  }

  @Delete('admin/:itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async adminDeleteItem(@Param('itemId') itemId: string) {
    this.logger.log(`Admin: Deleting inventory item ${itemId}`);
    await this.inventoryService.adminDeleteItem(itemId);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  async reorderItems(
    @Request() req,
    @Body() dto: { itemIds: string[] },
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Reordering ${dto.itemIds?.length ?? 0} inventory items for user ${userId}`);
    return this.inventoryService.reorderItems(userId, dto.itemIds || []);
  }

  @Patch(':id')
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
  async deleteItem(@Request() req, @Param('id') id: string) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Deleting inventory item ${id} for user ${userId}`);
    await this.inventoryService.deleteItem(userId, id);
  }


  @Post('discard')
  @HttpCode(HttpStatus.OK)
  async discardItem(@Request() req, @Body() dto: DiscardInventoryItemDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Discarding inventory item ${dto.itemId} for user ${userId}`,
    );
    return this.inventoryService.discardItem(userId, dto);
  }

  @Post('waste-classify')
  @HttpCode(HttpStatus.OK)
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
