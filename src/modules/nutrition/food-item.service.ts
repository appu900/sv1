import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FoodItem,
  FoodItemDocument,
  FoodSource,
} from '../../database/schemas/nutrition/food-item.schema';

export interface FoodSearchOptions {
  q?: string;
  locale?: string;
  limit?: number;
  verifiedOnly?: boolean;
}

@Injectable()
export class FoodItemService {
  constructor(
    @InjectModel(FoodItem.name)
    private readonly foodModel: Model<FoodItemDocument>,
  ) {}

  async search(opts: FoodSearchOptions): Promise<FoodItemDocument[]> {
    const q = (opts.q ?? '').trim();
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const locale = (opts.locale ?? 'global').trim();

    const baseFilter: Record<string, any> = { isPublic: true };
    if (opts.verifiedOnly) baseFilter.verified = true;

    if (!q) {
      return this.foodModel
        .find(baseFilter)
        .sort({ verified: -1, confidence: -1, canonicalName: 1 })
        .limit(limit)
        .lean<FoodItemDocument[]>()
        .exec();
    }

    const textResults = await this.foodModel
      .find(
        { ...baseFilter, $text: { $search: q } },
        { score: { $meta: 'textScore' } },
      )
      .sort({ score: { $meta: 'textScore' }, verified: -1, confidence: -1 })
      .limit(limit)
      .lean<FoodItemDocument[]>()
      .exec();

    if (textResults.length >= limit) {
      return this.rankByLocale(textResults, locale).slice(0, limit);
    }

    const seen = new Set(textResults.map((d) => String(d._id)));
    const prefixResults = await this.foodModel
      .find({
        ...baseFilter,
        canonicalName: { $regex: `^${this.escapeRegex(q.toLowerCase())}` },
        _id: { $nin: [...seen].map((id) => id) },
      })
      .sort({ verified: -1, confidence: -1, canonicalName: 1 })
      .limit(limit - textResults.length)
      .lean<FoodItemDocument[]>()
      .exec();

    return this.rankByLocale([...textResults, ...prefixResults], locale).slice(
      0,
      limit,
    );
  }

  async findById(id: string): Promise<FoodItemDocument> {
    const doc = await this.foodModel.findById(id).lean<FoodItemDocument>().exec();
    if (!doc) throw new NotFoundException('Food not found');
    return doc;
  }

  async findByBarcode(barcode: string): Promise<FoodItemDocument | null> {
    const trimmed = barcode.trim();
    if (!trimmed) return null;
    return this.foodModel
      .findOne({ barcode: trimmed })
      .lean<FoodItemDocument>()
      .exec();
  }

  async upsert(partial: Partial<FoodItem>): Promise<FoodItemDocument> {
    const filter: Record<string, any> = partial.barcode
      ? { barcode: partial.barcode }
      : {
          canonicalName: (partial.canonicalName ?? '').toLowerCase(),
          brand: partial.brand ?? null,
          locale: partial.locale ?? 'global',
          source: partial.source ?? FoodSource.MANUAL,
        };

    return this.foodModel
      .findOneAndUpdate(
        filter,
        { $set: partial },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<FoodItemDocument>()
      .exec();
  }

  async bulkUpsert(items: Partial<FoodItem>[]): Promise<FoodItemDocument[]> {
    if (items.length === 0) return [];

    const ops = items.map((partial) => {
      const filter: Record<string, any> = partial.barcode
        ? { barcode: partial.barcode }
        : {
            canonicalName: (partial.canonicalName ?? '').toLowerCase(),
            brand: partial.brand ?? null,
            locale: partial.locale ?? 'global',
            source: partial.source ?? FoodSource.MANUAL,
          };
      return {
        updateOne: {
          filter,
          update: { $set: partial },
          upsert: true,
        },
      };
    });

    await this.foodModel.bulkWrite(ops, { ordered: false });

    const filters = items.map((partial) =>
      partial.barcode
        ? { barcode: partial.barcode }
        : {
            canonicalName: (partial.canonicalName ?? '').toLowerCase(),
            brand: partial.brand ?? null,
            locale: partial.locale ?? 'global',
            source: partial.source ?? FoodSource.MANUAL,
          },
    );

    return this.foodModel
      .find({ $or: filters })
      .lean<FoodItemDocument[]>()
      .exec();
  }

  private rankByLocale(
    docs: FoodItemDocument[],
    locale: string,
  ): FoodItemDocument[] {
    if (!locale || locale === 'global') return docs;
    return [...docs].sort((a, b) => {
      const aLoc = a.locale === locale ? 0 : a.locale === 'global' ? 1 : 2;
      const bLoc = b.locale === locale ? 0 : b.locale === 'global' ? 1 : 2;
      if (aLoc !== bLoc) return aLoc - bLoc;
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export { FoodSource };
