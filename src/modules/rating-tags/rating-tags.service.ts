import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId, Types } from 'mongoose';
import { RatingTag, RatingTagDocument } from 'src/database/schemas/rating-tag.schema';
import { CreateRatingTagDto } from './dto/create-rating-tag.dto';
import { UpdateRatingTagDto } from './dto/update-rating-tag.dto';

@Injectable()
export class RatingTagsService {
  constructor(
    @InjectModel(RatingTag.name)
    private ratingTagModel: Model<RatingTagDocument>,
  ) {}

  async create(createRatingTagDto: CreateRatingTagDto): Promise<RatingTag> {
    // Check if tag with same name already exists
    const existingTag = await this.ratingTagModel.findOne({
      name: createRatingTagDto.name,
    });

    if (existingTag) {
      throw new ConflictException(
        `Rating tag with name "${createRatingTagDto.name}" already exists`,
      );
    }

    const ratingTag = new this.ratingTagModel(createRatingTagDto);
    return await ratingTag.save();
  }

  async findAll(): Promise<RatingTag[]> {
    return await this.ratingTagModel.find().sort({ order: -1 }).lean();
  }

  async findActive(): Promise<RatingTag[]> {
    return await this.ratingTagModel
      .find({ isActive: true })
      .sort({ order: -1 })
      .lean();
  }

  async findOne(id: string): Promise<RatingTag> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating tag ID "${id}"`);
    }

    const ratingTag = await this.ratingTagModel.findById(id).lean();

    if (!ratingTag) {
      throw new NotFoundException(`Rating tag with ID "${id}" not found`);
    }

    return ratingTag;
  }

  async update(
    id: string,
    updateRatingTagDto: UpdateRatingTagDto,
  ): Promise<RatingTag> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating tag ID "${id}"`);
    }

    // Check name uniqueness if name is being updated
    if (updateRatingTagDto.name) {
      const existingTag = await this.ratingTagModel.findOne({
        name: updateRatingTagDto.name,
        _id: { $ne: new Types.ObjectId(id) },
      });

      if (existingTag) {
        throw new ConflictException(
          `Rating tag with name "${updateRatingTagDto.name}" already exists`,
        );
      }
    }

    const ratingTag = await this.ratingTagModel
      .findByIdAndUpdate(id, updateRatingTagDto, { new: true })
      .lean();

    if (!ratingTag) {
      throw new NotFoundException(`Rating tag with ID "${id}" not found`);
    }

    return ratingTag;
  }

  async remove(id: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid rating tag ID "${id}"`);
    }

    const result = await this.ratingTagModel.findByIdAndDelete(id);

    if (!result) {
      throw new NotFoundException(`Rating tag with ID "${id}" not found`);
    }
  }
}
