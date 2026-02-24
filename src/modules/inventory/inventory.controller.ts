import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryAiService } from './inventory-ai.service';
import { AddInventoryItemDto } from './dto/add-inventory-item.dto';
import { BatchAddInventoryItemsDto } from './dto/batch-add-inventory-items.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { DiscardInventoryItemDto } from './dto/discard-inventory-item.dto';
import { VoiceAddInventoryDto } from './dto/voice-add-inventory.dto';
import {
  GetInventoryQueryDto,
  WasteClassifyDto,
} from './dto/get-inventory-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorators';
import { UserRole } from '../../database/schemas/user.auth.schema';
import { InventoryItemSource } from '../../database/schemas/user-inventory.schema';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly inventoryAiService: InventoryAiService,
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
    return this.inventoryService.addItem(userId, dto);
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async addBatch(@Request() req, @Body() dto: BatchAddInventoryItemsDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Batch adding ${dto.items.length} inventory items for user ${userId}`,
    );
    return this.inventoryService.addBatch(userId, dto);
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

    const itemsWithSource = {
      items: dto.items.map((item) => ({
        ...item,
        source: InventoryItemSource.VOICE,
      })),
    };

    return this.inventoryService.addBatch(userId, itemsWithSource as any);
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
  async classifyWaste(@Body() dto: WasteClassifyDto) {
    return this.inventoryAiService.classifyWaste(
      dto.ingredientName,
      dto.packaging,
    );
  }
}
