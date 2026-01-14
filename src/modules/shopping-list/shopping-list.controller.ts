import {
  Controller,
  Get,
  Post,
  Put,
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

@Controller('shopping-list')
@UseGuards(JwtAuthGuard)
export class ShoppingListController {
  private readonly logger = new Logger(ShoppingListController.name);

  constructor(private readonly shoppingListService: ShoppingListService) {}

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
    } catch (error) {
      this.logger.error(
        `Error adding ingredients from recipe: ${error.message}`,
        error.stack,
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
    
    return this.shoppingListService.archiveCurrentList(userId);
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
