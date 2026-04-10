import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserInventoryItem,
  UserInventoryItemDocument,
  StorageLocation,
  FreshnessStatus,
  InventoryItemSource,
  WasteType,
  DiscardReason,
} from '../../database/schemas/user-inventory.schema';
import {
  Ingredient,
  IngredientDocument,
} from '../../database/schemas/ingredient.schema';
import {
  ShoppingList,
  ShoppingListDocument,
  ShoppingListItemSource,
  ShoppingListItemStatus,
} from '../../database/schemas/shopping-list.schema';
import {
  User,
  UserDocument,
} from '../../database/schemas/user.auth.schema';
import { AddInventoryItemDto } from './dto/add-inventory-item.dto';
import { BatchAddInventoryItemsDto } from './dto/batch-add-inventory-items.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { DiscardInventoryItemDto } from './dto/discard-inventory-item.dto';
import { ConsumeInventoryItemsDto } from './dto/consume-inventory-items.dto';
import { GetInventoryQueryDto } from './dto/get-inventory-query.dto';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private readonly CACHE_PREFIX = 'inventory';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(
    @InjectModel(UserInventoryItem.name)
    private inventoryModel: Model<UserInventoryItemDocument>,
    @InjectModel(Ingredient.name)
    private ingredientModel: Model<IngredientDocument>,
    @InjectModel(ShoppingList.name)
    private shoppingListModel: Model<ShoppingListDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private readonly redisService: RedisService,
  ) {}


  async getInventory(
    userId: string,
    query: GetInventoryQueryDto,
  ): Promise<UserInventoryItemDocument[]> {
    const filter: any = {
      userId: new Types.ObjectId(userId),
      isDiscarded: false,
    };

    if (query.storageLocation) {
      filter.storageLocation = query.storageLocation;
    }

    if (query.freshnessStatus) {
      filter.freshnessStatus = query.freshnessStatus;
    }

    if (query.search) {
      filter.name = { $regex: query.search, $options: 'i' };
    }

    if (query.expiringWithinDays) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + query.expiringWithinDays);
      filter.expiresAt = { $lte: futureDate, $gte: new Date() };
    }

    const items = await this.inventoryModel
      .find(filter)
      .populate('ingredientId', 'name heroImageUrl theme categoryId')
      .populate('categoryId', 'name')
      .sort({ expiresAt: 1, createdAt: -1 })
      .lean()
      .exec();

    return items as UserInventoryItemDocument[];
  }

  async getInventoryGroupedByStorage(userId: string): Promise<{
    pantry: UserInventoryItemDocument[];
    fridge: UserInventoryItemDocument[];
    freezer: UserInventoryItemDocument[];
    other: UserInventoryItemDocument[];
    summary: {
      total: number;
      expiringSoon: number;
      expired: number;
    };
  }> {
    const cacheKey = `${this.CACHE_PREFIX}:grouped:${userId}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      this.logger.warn('Cache read failed:', e?.message);
    }

    const items = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
      })
      .populate('ingredientId', 'name heroImageUrl theme categoryId')
      .populate('categoryId', 'name')
      .sort({ expiresAt: 1, createdAt: -1 })
      .lean()
      .exec();

    // Update freshness statuses in-memory before grouping
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    const itemsWithStatus = items.map((item) => {
      if (item.expiresAt) {
        const expiresAt = new Date(item.expiresAt);
        if (expiresAt < now) {
          item.freshnessStatus = FreshnessStatus.EXPIRED;
        } else if (expiresAt <= threeDaysFromNow) {
          item.freshnessStatus = FreshnessStatus.EXPIRING_SOON;
        } else {
          item.freshnessStatus = FreshnessStatus.FRESH;
        }
      }
      return item;
    });

    const grouped = {
      pantry: itemsWithStatus.filter(
        (i) => i.storageLocation === StorageLocation.PANTRY,
      ),
      fridge: itemsWithStatus.filter(
        (i) => i.storageLocation === StorageLocation.FRIDGE,
      ),
      freezer: itemsWithStatus.filter(
        (i) => i.storageLocation === StorageLocation.FREEZER,
      ),
      other: itemsWithStatus.filter(
        (i) => i.storageLocation === StorageLocation.OTHER,
      ),
      summary: {
        total: itemsWithStatus.length,
        expiringSoon: itemsWithStatus.filter(
          (i) => i.freshnessStatus === FreshnessStatus.EXPIRING_SOON,
        ).length,
        expired: itemsWithStatus.filter(
          (i) => i.freshnessStatus === FreshnessStatus.EXPIRED,
        ).length,
      },
    };

    try {
      await this.redisService.set(cacheKey, JSON.stringify(grouped), this.CACHE_TTL);
    } catch (e) {
      this.logger.warn('Cache write failed:', e?.message);
    }

    return grouped as any;
  }


  async addItem(
    userId: string,
    dto: AddInventoryItemDto,
  ): Promise<UserInventoryItemDocument> {
    let enrichedData: any = { ...dto };
    if (dto.ingredientId && Types.ObjectId.isValid(dto.ingredientId)) {
      const ingredient = await this.ingredientModel
        .findById(dto.ingredientId)
        .lean()
        .exec();
      if (ingredient) {
        enrichedData.heroImageUrl = enrichedData.heroImageUrl || ingredient.heroImageUrl;
        enrichedData.categoryId = enrichedData.categoryId || ingredient.categoryId;
        enrichedData.name = enrichedData.name || ingredient.name;
      }
    }

    const item = await this.inventoryModel.create({
      ...enrichedData,
      userId: new Types.ObjectId(userId),
      ingredientId: dto.ingredientId && Types.ObjectId.isValid(dto.ingredientId)
        ? new Types.ObjectId(dto.ingredientId)
        : undefined,
      categoryId: enrichedData.categoryId && Types.ObjectId.isValid(enrichedData.categoryId)
        ? new Types.ObjectId(enrichedData.categoryId)
        : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      addedAt: new Date(),
      source: dto.source || InventoryItemSource.MANUAL,
      countries: dto.country ? [dto.country] : [],
    });

    try {
      await this.invalidateCache(userId);
    } catch (e) {
      this.logger.warn(`Cache invalidation failed after addItem: ${(e as Error).message}`);
    }
    this.logger.log(`Added inventory item "${item.name}" for user ${userId}`);
    return item;
  }

  async addBatch(
    userId: string,
    dto: BatchAddInventoryItemsDto,
  ): Promise<UserInventoryItemDocument[]> {
    const items = await Promise.all(
      dto.items.map((itemDto) => this.addItem(userId, itemDto)),
    );

    this.logger.log(
      `Batch added ${items.length} inventory items for user ${userId}`,
    );
    return items;
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateInventoryItemDto,
  ): Promise<UserInventoryItemDocument> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('Invalid item ID');
    }

    const item = await this.inventoryModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(itemId),
          userId: new Types.ObjectId(userId),
          isDiscarded: false,
        },
        {
          $set: {
            ...dto,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          },
        },
        { new: true },
      )
      .exec();

    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    try {
      await this.invalidateCache(userId);
    } catch (e) {
      this.logger.warn(`Cache invalidation failed after updateItem: ${(e as Error).message}`);
    }
    this.logger.log(`Updated inventory item ${itemId} for user ${userId}`);
    return item;
  }


  async deleteItem(userId: string, itemId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('Invalid item ID');
    }

    const result = await this.inventoryModel
      .findOneAndDelete({
        _id: new Types.ObjectId(itemId),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!result) {
      throw new NotFoundException('Inventory item not found');
    }

    try {
      await this.invalidateCache(userId);
    } catch (e) {
      this.logger.warn(`Cache invalidation failed after deleteItem: ${(e as Error).message}`);
    }
    this.logger.log(`Deleted inventory item ${itemId} for user ${userId}`);
  }


  async discardItem(
    userId: string,
    dto: DiscardInventoryItemDto,
  ): Promise<UserInventoryItemDocument> {
    if (!Types.ObjectId.isValid(dto.itemId)) {
      throw new BadRequestException('Invalid item ID');
    }

    const item = await this.inventoryModel
      .findOne({
        _id: new Types.ObjectId(dto.itemId),
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
      })
      .exec();

    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    const isPartialDiscard =
      dto.discardedQuantity !== undefined &&
      dto.discardedQuantity > 0 &&
      dto.discardedQuantity < item.quantity;

    if (isPartialDiscard) {
      item.quantity -= dto.discardedQuantity!;
      await item.save();

      const discardRecord = await this.inventoryModel.create({
        userId: new Types.ObjectId(userId),
        ingredientId: item.ingredientId,
        name: item.name,
        quantity: dto.discardedQuantity,
        unit: item.unit,
        storageLocation: item.storageLocation,
        source: item.source,
        isDiscarded: true,
        wasteType: dto.wasteType,
        discardReason: dto.reason,
        discardNotes: dto.notes,
        discardedAt: new Date(),
        discardedQuantity: dto.discardedQuantity,
        heroImageUrl: item.heroImageUrl,
        categoryId: item.categoryId,
        countries: item.countries,
      });

      if (dto.addToShoppingList) {
        await this.addToShoppingList(userId, item);
      }

      try {
        await this.invalidateCache(userId);
      } catch (e) {
        this.logger.warn(`Cache invalidation failed after partial discard: ${(e as Error).message}`);
      }
      this.logger.log(
        `Partially discarded ${dto.discardedQuantity} ${item.unit} of "${item.name}" for user ${userId}`,
      );
      return discardRecord;
    }

    item.isDiscarded = true;
    item.wasteType = dto.wasteType;
    item.discardReason = dto.reason;
    item.discardNotes = dto.notes;
    item.discardedAt = new Date();
    item.discardedQuantity = item.quantity;
    await item.save();

    if (dto.addToShoppingList) {
      await this.addToShoppingList(userId, item);
    }

    try {
      await this.invalidateCache(userId);
    } catch (e) {
      this.logger.warn(`Cache invalidation failed after full discard: ${(e as Error).message}`);
    }
    this.logger.log(
      `Fully discarded "${item.name}" (${dto.reason}, ${dto.wasteType}) for user ${userId}`,
    );
    return item;
  }


  /**
   * Consume inventory items after cooking a recipe.
   * For each ingredient in the list, finds the matching inventory item
   * (preferring the one expiring soonest to reduce waste) and marks it
   * as discarded with reason COOKED.
   */
  async consumeItems(
    userId: string,
    dto: ConsumeInventoryItemsDto,
  ): Promise<{ consumed: number; items: UserInventoryItemDocument[] }> {
    const userOid = new Types.ObjectId(userId);
    const consumedItems: UserInventoryItemDocument[] = [];

    for (const ingredient of dto.ingredients) {
      if (!Types.ObjectId.isValid(ingredient.ingredientId)) {
        this.logger.warn(
          `Skipping invalid ingredientId: ${ingredient.ingredientId}`,
        );
        continue;
      }

      const ingredientOid = new Types.ObjectId(ingredient.ingredientId);

      // Find the inventory item with this ingredientId, preferring the one expiring soonest
      const item = await this.inventoryModel
        .findOne({
          userId: userOid,
          ingredientId: ingredientOid,
          isDiscarded: false,
        })
        .sort({ expiresAt: 1 }) // expiring soonest first to reduce waste
        .exec();

      if (item) {
        // Fully mark as consumed/cooked
        item.isDiscarded = true;
        item.discardReason = DiscardReason.COOKED;
        item.wasteType = WasteType.WET;
        item.discardedAt = new Date();
        item.discardedQuantity = item.quantity;
        await item.save();
        consumedItems.push(item);
      }
    }

    if (consumedItems.length > 0) {
      try {
        await this.invalidateCache(userId);
      } catch (e) {
        this.logger.warn(`Cache invalidation failed after consume: ${(e as Error).message}`);
      }
      this.logger.log(
        `Consumed ${consumedItems.length} inventory items for user ${userId} (recipe: ${dto.recipeId || 'unknown'})`,
      );
    }

    return {
      consumed: consumedItems.length,
      items: consumedItems,
    };
  }


  async getExpiringItems(
    userId: string,
    withinDays = 3,
  ): Promise<UserInventoryItemDocument[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + withinDays);

    return this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
        expiresAt: { $lte: futureDate, $gte: new Date() },
      })
      .populate('ingredientId', 'name heroImageUrl theme')
      .sort({ expiresAt: 1 })
      .lean()
      .exec();
  }


  async getWasteAnalytics(userId: string): Promise<{
    totalDiscarded: number;
    byWasteType: Record<string, number>;
    byReason: Record<string, number>;
    byMonth: { month: string; count: number; quantity: number }[];
    topWastedItems: { name: string; count: number; totalQuantity: number }[];
  }> {
    const userOid = new Types.ObjectId(userId);

    const [byWasteType, byReason, byMonth, topWasted, totalCount] =
      await Promise.all([
        // Group by waste type
        this.inventoryModel.aggregate([
          { $match: { userId: userOid, isDiscarded: true } },
          { $group: { _id: '$wasteType', count: { $sum: 1 } } },
        ]),
        // Group by reason
        this.inventoryModel.aggregate([
          { $match: { userId: userOid, isDiscarded: true } },
          { $group: { _id: '$discardReason', count: { $sum: 1 } } },
        ]),
        // Group by month
        this.inventoryModel.aggregate([
          { $match: { userId: userOid, isDiscarded: true } },
          {
            $group: {
              _id: {
                year: { $year: '$discardedAt' },
                month: { $month: '$discardedAt' },
              },
              count: { $sum: 1 },
              quantity: { $sum: '$discardedQuantity' },
            },
          },
          { $sort: { '_id.year': -1, '_id.month': -1 } },
          { $limit: 12 },
        ]),
        // Top wasted items
        this.inventoryModel.aggregate([
          { $match: { userId: userOid, isDiscarded: true } },
          {
            $group: {
              _id: '$name',
              count: { $sum: 1 },
              totalQuantity: { $sum: '$discardedQuantity' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        // Total count
        this.inventoryModel.countDocuments({
          userId: userOid,
          isDiscarded: true,
        }),
      ]);

    return {
      totalDiscarded: totalCount,
      byWasteType: Object.fromEntries(
        byWasteType.map((r) => [r._id || 'unknown', r.count]),
      ),
      byReason: Object.fromEntries(
        byReason.map((r) => [r._id || 'unknown', r.count]),
      ),
      byMonth: byMonth.map((r) => ({
        month: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
        count: r.count,
        quantity: r.quantity,
      })),
      topWastedItems: topWasted.map((r) => ({
        name: r._id,
        count: r.count,
        totalQuantity: r.totalQuantity,
      })),
    };
  }


  async getOutOfStockStaples(userId: string): Promise<string[]> {
    const staples = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isStaple: true,
        isDiscarded: false,
      })
      .lean()
      .exec();

    const outOfStock = staples.filter((item) => item.quantity <= 0);
    return outOfStock.map((item) => item.name);
  }


  async getInventoryIngredientIds(userId: string): Promise<string[]> {
    const items = await this.inventoryModel
      .find({
        userId: new Types.ObjectId(userId),
        isDiscarded: false,
        ingredientId: { $exists: true, $ne: null },
      })
      .select('ingredientId')
      .lean()
      .exec();

    return items
      .map((i) => i.ingredientId?.toString())
      .filter(Boolean) as string[];
  }


  private async addToShoppingList(
    userId: string,
    item: UserInventoryItemDocument,
  ): Promise<void> {
    try {
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
      }

      list.items.push({
        ingredientId: item.ingredientId,
        ingredientName: item.name,
        quantity: String(item.quantity),
        unit: item.unit,
        source: ShoppingListItemSource.MANUAL,
        status: ShoppingListItemStatus.PENDING,
        addedAt: new Date(),
      } as any);

      list.updatedAt = new Date();
      await list.save();

      this.logger.log(
        `Auto-added "${item.name}" to shopping list for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to auto-add to shopping list: ${error.message}`,
      );
    }
  }

  private async invalidateCache(userId: string): Promise<void> {
    try {
      await this.redisService.del(`${this.CACHE_PREFIX}:grouped:${userId}`);
    } catch (e) {
      this.logger.warn('Cache invalidation failed:', e?.message);
    }
    // Also clear the AI meal-suggestions cache so the next fetch re-computes
    // against the updated inventory instead of returning stale suggestions.
    try {
      await this.redisService.delByPattern(`inventory-ai:suggestions:quick:${userId}*`);
    } catch (e) {
      this.logger.warn('AI suggestions cache invalidation failed:', e?.message);
    }
  }

  async adminGetInventoryOverview(): Promise<{
    totalUsers: number;
    totalItems: number;
    totalDiscarded: number;
    avgItemsPerUser: number;
    topWastedIngredients: { name: string; count: number }[];
    wasteByType: { type: string; count: number }[];
  }> {
    const [totalItems, totalDiscarded, distinctUsers, topWasted, wasteByType] =
      await Promise.all([
        this.inventoryModel.countDocuments({ isDiscarded: false }),
        this.inventoryModel.countDocuments({ isDiscarded: true }),
        this.inventoryModel.distinct('userId', { isDiscarded: false }),
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true } },
          { $group: { _id: '$name', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true, wasteType: { $exists: true } } },
          { $group: { _id: '$wasteType', count: { $sum: 1 } } },
        ]),
      ]);

    const totalUsers = distinctUsers.length;

    return {
      totalUsers,
      totalItems,
      totalDiscarded,
      avgItemsPerUser: totalUsers > 0 ? Math.round(totalItems / totalUsers) : 0,
      topWastedIngredients: topWasted.map((r) => ({
        name: r._id,
        count: r.count,
      })),
      wasteByType: wasteByType.map((r) => ({
        type: r._id || 'unknown',
        count: r.count,
      })),
    };
  }

  async adminGetGlobalWasteAnalytics(): Promise<{
    totalDiscarded: number;
    byWasteType: Record<string, number>;
    byReason: Record<string, number>;
    byMonth: { month: string; count: number; quantity: number }[];
    topWastedItems: { name: string; count: number; totalQuantity: number }[];
  }> {
    const [byWasteType, byReason, byMonth, topWasted, totalCount] =
      await Promise.all([
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true } },
          { $group: { _id: '$wasteType', count: { $sum: 1 } } },
        ]),
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true } },
          { $group: { _id: '$discardReason', count: { $sum: 1 } } },
        ]),
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true } },
          {
            $group: {
              _id: {
                year: { $year: '$discardedAt' },
                month: { $month: '$discardedAt' },
              },
              count: { $sum: 1 },
              quantity: { $sum: '$discardedQuantity' },
            },
          },
          { $sort: { '_id.year': -1, '_id.month': -1 } },
          { $limit: 12 },
        ]),
        this.inventoryModel.aggregate([
          { $match: { isDiscarded: true } },
          {
            $group: {
              _id: '$name',
              count: { $sum: 1 },
              totalQuantity: { $sum: '$discardedQuantity' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        this.inventoryModel.countDocuments({ isDiscarded: true }),
      ]);

    return {
      totalDiscarded: totalCount,
      byWasteType: Object.fromEntries(
        byWasteType.map((r) => [r._id || 'unknown', r.count]),
      ),
      byReason: Object.fromEntries(
        byReason.map((r) => [r._id || 'unknown', r.count]),
      ),
      byMonth: byMonth.map((r) => ({
        month: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
        count: r.count,
        quantity: r.quantity,
      })),
      topWastedItems: topWasted.map((r) => ({
        name: r._id,
        count: r.count,
        totalQuantity: r.totalQuantity,
      })),
    };
  }

  async adminGetGlobalExpiringItems(days = 3): Promise<{
    total: number;
    users: { userId: string; email: string; expiringCount: number }[];
  }> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const results = await this.inventoryModel.aggregate([
      {
        $match: {
          isDiscarded: false,
          expiresAt: { $lte: futureDate, $gte: new Date() },
        },
      },
      {
        $group: {
          _id: '$userId',
          expiringCount: { $sum: 1 },
        },
      },
      { $sort: { expiringCount: -1 } },
      { $limit: 50 },
    ]);

    const userIds = results.map((r) => r._id);
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('email')
      .lean()
      .exec();
    const userMap = new Map(users.map((u) => [u._id.toString(), u.email]));

    return {
      total: results.reduce((sum, r) => sum + r.expiringCount, 0),
      users: results.map((r) => ({
        userId: r._id.toString(),
        email: userMap.get(r._id.toString()) || 'unknown',
        expiringCount: r.expiringCount,
      })),
    };
  }

  async adminDeleteItem(itemId: string): Promise<void> {
    const item = await this.inventoryModel.findByIdAndDelete(itemId).exec();
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    await this.invalidateCache(item.userId.toString()).catch((e) =>
      this.logger.warn(`Cache invalidation failed after adminDelete: ${(e as Error).message}`),
    );
  }
}
