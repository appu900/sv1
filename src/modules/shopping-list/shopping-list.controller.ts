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
import { ShoppingListService } from './shopping-list.service';
import { AddShoppingListItemDto } from './dto/add-shopping-list-item.dto';
import { UpdateShoppingListItemDto } from './dto/update-shopping-list-item.dto';
import { AddIngredientsFromRecipeDto } from './dto/add-ingredients-from-recipe.dto';
import { BatchUpdateItemsDto } from './dto/batch-update-items.dto';
import { GetShoppingListQueryDto } from './dto/get-shopping-list-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';

@Controller('shopping-list')
@UseGuards(JwtAuthGuard)
export class ShoppingListController {
  private readonly logger = new Logger(ShoppingListController.name);

  constructor(
    private readonly shoppingListService: ShoppingListService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get()
  async getShoppingList(@Request() req, @Query() query: GetShoppingListQueryDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching shopping list for user ${userId}`);
    
    return this.shoppingListService.getFilteredItems(userId, query.status);
  }

  @Get('statistics')
  async getStatistics(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Fetching shopping list statistics for user ${userId}`);
    
    return this.shoppingListService.getStatistics(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addItem(@Request() req, @Body() dto: AddShoppingListItemDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Adding item to shopping list for user ${userId}`);
    
    return this.shoppingListService.addItem(userId, dto);
  }

  @Post('from-recipe')
  @HttpCode(HttpStatus.CREATED)
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
  async batchUpdateItems(@Request() req, @Body() dto: BatchUpdateItemsDto) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(
      `Batch updating ${dto.updates.length} items for user ${userId}`,
    );
    
    return this.shoppingListService.batchUpdateItems(userId, dto.updates);
  }

  @Post('archive')
  @HttpCode(HttpStatus.OK)
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
  async clearPurchasedItems(@Request() req) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Clearing purchased items for user ${userId}`);
    
    return this.shoppingListService.clearPurchasedItems(userId);
  }

  @Delete(':index')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(@Request() req, @Param('index') index: number) {
    const userId = req.user._id || req.user.userId;
    this.logger.log(`Deleting shopping list item at index ${index} for user ${userId}`);
    
    await this.shoppingListService.deleteItemByIndex(userId, Number(index));
  }
}
