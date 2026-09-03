import {
  Controller,
  Get,
  Post,
  Put,
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
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { ShoppingListService } from './shopping-list.service';
import { AddShoppingListItemDto } from './dto/add-shopping-list-item.dto';
import { UpdateShoppingListItemDto } from './dto/update-shopping-list-item.dto';
import { AddIngredientsFromRecipeDto } from './dto/add-ingredients-from-recipe.dto';
import { BatchUpdateItemsDto } from './dto/batch-update-items.dto';
import { GetShoppingListQueryDto } from './dto/get-shopping-list-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiJwtAuth } from '../../common/swagger/api-auth.decorators';
import { SubscriptionService } from '../subscription/subscription.service';

@ApiTags('Shopping List')
@ApiJwtAuth()
@Controller('shopping-list')
@UseGuards(JwtAuthGuard)
export class ShoppingListController {
  private readonly logger = new Logger(ShoppingListController.name);

  constructor(
    private readonly shoppingListService: ShoppingListService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get the current shopping list',
    description:
      'Returns the authenticated user’s active shopping-list items. Optionally filter by `status` (`PENDING` or `PURCHASED`).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter items by PENDING or PURCHASED.',
  })
  @ApiOkResponse({ description: 'Shopping list items.' })
  async getShoppingList(@Request() req, @Query() query: GetShoppingListQueryDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching shopping list for user ${userId}`);
    
    return this.shoppingListService.getFilteredItems(userId, query.status);
  }

  @Get('statistics')
  @ApiOperation({
    summary: 'Get shopping-list statistics',
    description:
      'Returns counts for pending vs purchased items and other list totals used on the shopping-list header.',
  })
  @ApiOkResponse({ description: 'Shopping list statistics.' })
  async getStatistics(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching shopping list statistics for user ${userId}`);
    
    return this.shoppingListService.getStatistics(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an item to the shopping list',
    description:
      'Adds a single manual item (name, quantity, unit, optional ingredient id) to the user’s active shopping list.',
  })
  @ApiBody({ type: AddShoppingListItemDto })
  @ApiCreatedResponse({ description: 'Item added.' })
  async addItem(@Request() req, @Body() dto: AddShoppingListItemDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Adding item to shopping list for user ${userId}`);
    
    return this.shoppingListService.addItem(userId, dto);
  }

  @Post('from-recipe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add recipe ingredients to the shopping list',
    description:
      'Bulk-adds ingredients from a recipe. Missing pantry items are typically included; already-owned staples may be skipped by the service.',
  })
  @ApiBody({ type: AddIngredientsFromRecipeDto })
  @ApiCreatedResponse({ description: 'Recipe ingredients added.' })
  async addIngredientsFromRecipe(
    @Request() req,
    @Body() dto: AddIngredientsFromRecipeDto,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Adding ${dto.ingredients.length} ingredients from recipe ${dto.recipeId} to shopping list for user ${userId}`,
    );
    
    try {
      return await this.shoppingListService.addIngredientsFromRecipe(userId, dto);
    } catch (error: unknown) {
      this.logger.error(
        `Error adding ingredients from recipe: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  @Post('batch-update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch-update shopping-list items',
    description:
      'Applies many status / quantity updates in one request (for example marking several items purchased after a shop).',
  })
  @ApiBody({ type: BatchUpdateItemsDto })
  @ApiOkResponse({ description: 'Items updated.' })
  async batchUpdateItems(@Request() req, @Body() dto: BatchUpdateItemsDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Batch updating ${dto.updates.length} items for user ${userId}`,
    );
    
    return this.shoppingListService.batchUpdateItems(userId, dto.updates);
  }

  @Post('archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive the current shopping list',
    description:
      'Archives the active list and starts a fresh one. Enforces the plan’s shopping-list cap (basic plans are limited). The response includes a `quota` object.',
  })
  @ApiOkResponse({ description: 'List archived and a new active list created.' })
  async archiveCurrentList(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Archiving shopping list for user ${userId}`);

    // Count the user's total lists (active + archived). Archiving creates a
    // fresh active list, so enforce the plan cap (basic = 5 lists).
    const existingLists =
      await this.shoppingListService.countUserLists(userId);
    const quota = await this.subscriptionService.enforceLiveLimit(
      userId,
      'shoppingLists',
      existingLists,
      1,
    );

    const result = await this.shoppingListService.archiveCurrentList(userId);
    return { ...(result as any), quota };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reorder shopping-list items',
    description:
      'Sets the display order of the active list. Send `orderedKeys` as the item keys in the desired order.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        orderedKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Item keys in the desired display order.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Items reordered.' })
  async reorderItems(
    @Request() req,
    @Body() dto: { orderedKeys?: string[] },
  ) {
    const userId = req.user._id || req.user.userId;
    const keys = Array.isArray(dto?.orderedKeys) ? dto.orderedKeys : [];
    this.logger.log(
      `Reordering ${keys.length} shopping list items for user ${userId}`,
    );
    return this.shoppingListService.reorderItems(userId, keys);
  }

  @Put(':index')
  @ApiOperation({
    summary: 'Update a shopping-list item by index',
    description:
      'Updates the item at the given zero-based index on the active list (name, quantity, unit, or purchased status).',
  })
  @ApiParam({ name: 'index', description: 'Zero-based index of the item on the active list.' })
  @ApiBody({ type: UpdateShoppingListItemDto })
  @ApiOkResponse({ description: 'Item updated.' })
  async updateItem(
    @Request() req,
    @Param('index') index: number,
    @Body() dto: UpdateShoppingListItemDto,
  ) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Updating shopping list item at index ${index} for user ${userId}`);
    
    return this.shoppingListService.updateItemByIndex(userId, Number(index), dto);
  }

  @Delete('purchased')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear purchased items',
    description:
      'Removes every PURCHASED item from the active shopping list, leaving pending items in place.',
  })
  @ApiOkResponse({ description: 'Purchased items cleared.' })
  async clearPurchasedItems(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Clearing purchased items for user ${userId}`);
    
    return this.shoppingListService.clearPurchasedItems(userId);
  }

  @Delete(':index')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a shopping-list item by index',
    description:
      'Removes the item at the given zero-based index from the active list. Returns 204 with no body.',
  })
  @ApiParam({ name: 'index', description: 'Zero-based index of the item to delete.' })
  @ApiOkResponse({ description: 'Item deleted (204 No Content).' })
  async deleteItem(@Request() req, @Param('index') index: number) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Deleting shopping list item at index ${index} for user ${userId}`);
    
    await this.shoppingListService.deleteItemByIndex(userId, Number(index));
  }
}
