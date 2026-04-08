import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  CustomFoodNutrition,
  UserCustomFood,
  UserCustomFoodDocument,
} from '../../database/schemas/nutrition/user-custom-food.schema';
import {
  CreateCustomFoodDto,
  NutritionFactsDto,
  UpdateCustomFoodDto,
} from './dto/custom-food.dto';

@Injectable()
export class UserCustomFoodService {
  constructor(
    @InjectModel(UserCustomFood.name)
    private readonly customFoodModel: Model<UserCustomFoodDocument>,
  ) {}

  async list(userId: string): Promise<UserCustomFoodDocument[]> {
    this.assertUserId(userId);
    return this.customFoodModel
      .find({ userId: new Types.ObjectId(userId), isActive: true })
      .sort({ updatedAt: -1 })
      .lean<UserCustomFoodDocument[]>()
      .exec();
  }

  async findOne(
    userId: string,
    id: string,
  ): Promise<UserCustomFoodDocument> {
    this.assertUserId(userId);
    this.assertId(id);
    const doc = await this.customFoodModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean<UserCustomFoodDocument>()
      .exec();
    if (!doc) throw new NotFoundException('Custom food not found');
    return doc;
  }

  async create(
    userId: string,
    dto: CreateCustomFoodDto,
  ): Promise<UserCustomFoodDocument> {
    this.assertUserId(userId);
    this.assertHasAnyNutrition(dto.per100g, dto.perServing);

    const normalizedName = dto.name.trim().toLowerCase();

    const existing = await this.customFoodModel
      .findOne({
        userId: new Types.ObjectId(userId),
        normalizedName,
      })
      .exec();

    if (existing && existing.isActive) {
      throw new ConflictException(
        'You already have a custom food with this name',
      );
    }

    const payload: Partial<UserCustomFood> = {
      userId: new Types.ObjectId(userId),
      name: dto.name.trim(),
      normalizedName,
      servingLabel: dto.servingLabel.trim(),
      servingGrams: dto.servingGrams ?? null,
      per100g: this.normalizeFacts(dto.per100g),
      perServing: this.normalizeFacts(dto.perServing),
      notes: (dto.notes ?? '').trim(),
      origin: dto.origin ?? 'user_entered',
      isActive: true,
    };

    if (existing) {
      existing.set(payload);
      await existing.save();
      return existing.toObject() as UserCustomFoodDocument;
    }

    const created = await this.customFoodModel.create(payload);
    return created.toObject() as UserCustomFoodDocument;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCustomFoodDto,
  ): Promise<UserCustomFoodDocument> {
    this.assertUserId(userId);
    this.assertId(id);

    const current = await this.customFoodModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .exec();
    if (!current) throw new NotFoundException('Custom food not found');

    const nextPer100g =
      dto.per100g !== undefined
        ? this.normalizeFacts(dto.per100g)
        : current.per100g;
    const nextPerServing =
      dto.perServing !== undefined
        ? this.normalizeFacts(dto.perServing)
        : current.perServing;

    this.assertHasAnyNutrition(nextPer100g, nextPerServing);

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      const normalized = trimmed.toLowerCase();
      if (normalized !== current.normalizedName) {
        const clash = await this.customFoodModel
          .findOne({
            userId: current.userId,
            normalizedName: normalized,
            isActive: true,
            _id: { $ne: current._id },
          })
          .lean()
          .exec();
        if (clash) {
          throw new ConflictException(
            'Another custom food with this name already exists',
          );
        }
        current.name = trimmed;
        current.normalizedName = normalized;
      }
    }

    if (dto.servingLabel !== undefined) {
      current.servingLabel = dto.servingLabel.trim();
    }
    if (dto.servingGrams !== undefined) {
      current.servingGrams = dto.servingGrams;
    }
    if (dto.per100g !== undefined) current.per100g = nextPer100g ?? null;
    if (dto.perServing !== undefined) current.perServing = nextPerServing ?? null;
    if (dto.notes !== undefined) current.notes = dto.notes.trim();

    await current.save();
    return current.toObject() as UserCustomFoodDocument;
  }

  async softDelete(userId: string, id: string): Promise<{ ok: true }> {
    this.assertUserId(userId);
    this.assertId(id);

    const res = await this.customFoodModel
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId),
          isActive: true,
        },
        { $set: { isActive: false } },
      )
      .exec();

    if (res.matchedCount === 0) {
      throw new NotFoundException('Custom food not found');
    }
    return { ok: true };
  }

  async findByIdForOwner(
    userId: string,
    id: string,
  ): Promise<UserCustomFoodDocument | null> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) return null;
    return this.customFoodModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean<UserCustomFoodDocument>()
      .exec();
  }

  private normalizeFacts(
    facts?: NutritionFactsDto | null,
  ): CustomFoodNutrition | null {
    if (!facts) return null;
    return {
      kcal: facts.kcal,
      protein_g: facts.protein_g ?? 0,
      carbs_g: facts.carbs_g ?? 0,
      fat_g: facts.fat_g ?? 0,
      fiber_g: facts.fiber_g ?? 0,
      sugar_g: facts.sugar_g ?? 0,
      sodium_mg: facts.sodium_mg ?? 0,
    };
  }

  private assertHasAnyNutrition(
    per100g?: CustomFoodNutrition | NutritionFactsDto | null,
    perServing?: CustomFoodNutrition | NutritionFactsDto | null,
  ) {
    if (!per100g && !perServing) {
      throw new BadRequestException(
        'At least one of per100g or perServing is required',
      );
    }
  }

  private assertUserId(userId: string) {
    if (!userId || !isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user id');
    }
  }

  private assertId(id: string) {
    if (!id || !isValidObjectId(id)) {
      throw new BadRequestException('Invalid custom food id');
    }
  }
}
