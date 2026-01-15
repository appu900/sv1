import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ShoppingList,
  ShoppingListDocument,
  ShoppingListItemData,
  ShoppingListItemSource,
  ShoppingListItemStatus,
} from '../../database/schemas/shopping-list.schema';
import { AddShoppingListItemDto } from './dto/add-shopping-list-item.dto';
import { UpdateShoppingListItemDto } from './dto/update-shopping-list-item.dto';
import { AddIngredientsFromRecipeDto } from './dto/add-ingredients-from-recipe.dto';

@Injectable()
export class ShoppingListService {
  private readonly logger = new Logger(ShoppingListService.name);

  constructor(
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<ShoppingListDocument>,
  ) {}

  async getCurrentList(userId: string): Promise<ShoppingListDocument> {
    let list = await this.shoppingListModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isArchived: false,
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!list) {
      list = await this.shoppingListModel.create({
        userId: new Types.ObjectId(userId),
        items: [],
        isArchived: false,
      });
      this.logger.log(`Created new shopping list for user ${userId}`);
    }

    return list;
  }

  async getFilteredItems(
    userId: string,
    status?: ShoppingListItemStatus,
  ): Promise<any> {
    const list = await this.getCurrentList(userId);
    
    let filteredItems = list.items;
    if (status) {
      filteredItems = list.items.filter(item => item.status === status);
    }

    // Populate ingredient details
    await list.populate('items.ingredientId');
    await list.populate('items.recipeId');

    return {
      listId: list._id,
      items: filteredItems,
      totalItems: list.items.length,
      pendingItems: list.items.filter(i => i.status === ShoppingListItemStatus.PENDING).length,
      purchasedItems: list.items.filter(i => i.status === ShoppingListItemStatus.PURCHASED).length,
    };
  }

  async addItem(
    userId: string,
    dto: AddShoppingListItemDto,
  ): Promise<ShoppingListDocument> {
    if (!dto.ingredientId && !dto.ingredientName) {
      throw new BadRequestException('Either ingredientId or ingredientName must be provided');
    }

    const list = await this.getCurrentList(userId);

    const newItem: ShoppingListItemData = {
      ingredientId: dto.ingredientId ? new Types.ObjectId(dto.ingredientId) : undefined,
      ingredientName: dto.ingredientName,
      quantity: dto.quantity,
      unit: dto.unit,
      source: dto.source || ShoppingListItemSource.MANUAL,
      status: ShoppingListItemStatus.PENDING,
      recipeId: dto.recipeId ? new Types.ObjectId(dto.recipeId) : undefined,
      notes: dto.notes,
      addedAt: new Date(),
      purchasedAt: undefined,
    };

    list.items.push(newItem);
    list.updatedAt = new Date();
    await list.save();

    this.logger.log(`Added item to shopping list for user ${userId}`);
    return list;
  }

  async addIngredientsFromRecipe(
    userId: string,
    dto: AddIngredientsFromRecipeDto,
  ): Promise<ShoppingListDocument> {
    try {
      const list = await this.getCurrentList(userId);

      this.logger.log(
        `Processing ${dto.ingredients.length} ingredients from recipe ${dto.recipeId} for user ${userId}`,
      );

      const newItems: ShoppingListItemData[] = dto.ingredients.map(ing => {
        if (!ing.ingredientName && !ing.ingredientId) {
          this.logger.error(`Invalid ingredient data: ${JSON.stringify(ing)}`);
          throw new BadRequestException('Ingredient must have either ingredientName or ingredientId');
        }

        return {
          ingredientId: ing.ingredientId ? new Types.ObjectId(ing.ingredientId) : undefined,
          ingredientName: ing.ingredientName || undefined,
          quantity: ing.quantity || '',
          source: ShoppingListItemSource.RECIPE,
          status: ShoppingListItemStatus.PENDING,
          recipeId: new Types.ObjectId(dto.recipeId),
          addedAt: new Date(),
        } as ShoppingListItemData;
      });

      list.items.push(...newItems);
      list.updatedAt = new Date();
      await list.save();
      
      // Populate ingredient and recipe details
      await list.populate('items.ingredientId');
      await list.populate('items.recipeId');

      this.logger.log(
        `Successfully added ${newItems.length} ingredients from recipe ${dto.recipeId} to shopping list for user ${userId}`,
      );

      return list;
    } catch (error) {
      this.logger.error(
        `Failed to add ingredients from recipe ${dto.recipeId} for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async batchUpdateItems(
    userId: string,
    updates: { index: number; status: ShoppingListItemStatus }[],
  ): Promise<ShoppingListDocument> {
    const list = await this.getCurrentList(userId);

    updates.forEach(update => {
      if (list.items[update.index]) {
        list.items[update.index].status = update.status;
        if (update.status === ShoppingListItemStatus.PURCHASED) {
          list.items[update.index].purchasedAt = new Date();
        }
      }
    });

    list.updatedAt = new Date();
    await list.save();

    this.logger.log(
      `Batch updated ${updates.length} items for user ${userId}`,
    );

    return list;
  }

  async updateItemByIndex(
    userId: string,
    index: number,
    dto: UpdateShoppingListItemDto,
  ): Promise<ShoppingListDocument> {
    const list = await this.getCurrentList(userId);

    if (!list.items[index]) {
      throw new NotFoundException(`Item at index ${index} not found`);
    }

    if (dto.quantity !== undefined) list.items[index].quantity = dto.quantity;
    if (dto.unit !== undefined) list.items[index].unit = dto.unit;
    if (dto.notes !== undefined) list.items[index].notes = dto.notes;
    
    if (dto.status !== undefined) {
      list.items[index].status = dto.status;
      if (dto.status === ShoppingListItemStatus.PURCHASED) {
        list.items[index].purchasedAt = new Date();
      }
    }

    list.updatedAt = new Date();
    await list.save();

    this.logger.log(`Updated item at index ${index} for user ${userId}`);
    return list;
  }

  async deleteItemByIndex(
    userId: string,
    index: number,
  ): Promise<ShoppingListDocument> {
    const list = await this.getCurrentList(userId);

    if (!list.items[index]) {
      throw new NotFoundException(`Item at index ${index} not found`);
    }

    list.items.splice(index, 1);
    list.updatedAt = new Date();
    await list.save();

    this.logger.log(`Deleted item at index ${index} for user ${userId}`);
    return list;
  }

  async clearPurchasedItems(userId: string): Promise<{ deletedCount: number }> {
    const list = await this.getCurrentList(userId);
    
    const beforeCount = list.items.length;
    list.items = list.items.filter(item => item.status !== ShoppingListItemStatus.PURCHASED);
    const deletedCount = beforeCount - list.items.length;

    list.updatedAt = new Date();
    await list.save();

    this.logger.log(
      `Cleared ${deletedCount} purchased items for user ${userId}`,
    );

    return { deletedCount };
  }

  async archiveCurrentList(userId: string): Promise<ShoppingListDocument> {
    const list = await this.getCurrentList(userId);
    
    list.isArchived = true;
    list.archivedAt = new Date();
    await list.save();

    this.logger.log(`Archived shopping list for user ${userId}`);
    return list;
  }

  async getStatistics(userId: string): Promise<{
    currentList: {
      total: number;
      pending: number;
      purchased: number;
      fromRecipes: number;
      manual: number;
    };
    totalListsCreated: number;
    totalListsArchived: number;
  }> {
    const currentList = await this.getCurrentList(userId);
    const totalLists = await this.shoppingListModel.countDocuments({
      userId: new Types.ObjectId(userId),
    });
    const archivedLists = await this.shoppingListModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isArchived: true,
    });

    return {
      currentList: {
        total: currentList.items.length,
        pending: currentList.items.filter(i => i.status === ShoppingListItemStatus.PENDING).length,
        purchased: currentList.items.filter(i => i.status === ShoppingListItemStatus.PURCHASED).length,
        fromRecipes: currentList.items.filter(i => i.source === ShoppingListItemSource.RECIPE).length,
        manual: currentList.items.filter(i => i.source === ShoppingListItemSource.MANUAL).length,
      },
      totalListsCreated: totalLists,
      totalListsArchived: archivedLists,
    };
  }
}
