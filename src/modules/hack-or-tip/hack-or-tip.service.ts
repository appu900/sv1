import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HackOrTip } from '../../database/schemas/hack-or-tip.schema';
import { CreateHackOrTipDto } from './dto/create-hack-or-tip.dto';
import { UpdateHackOrTipDto } from './dto/update-hack-or-tip.dto';

@Injectable()
export class HackOrTipService {
  constructor(
    @InjectModel(HackOrTip.name)
    private hackOrTipModel: Model<HackOrTip>,
  ) {}

  async create(createDto: CreateHackOrTipDto): Promise<HackOrTip> {
    try {
      // Validate sponsor ID if provided
      if (createDto.sponsorId) {
        if (!Types.ObjectId.isValid(createDto.sponsorId)) {
          throw new BadRequestException('Invalid sponsor ID');
        }
      }

      const hackOrTip = new this.hackOrTipModel({
        ...createDto,
        sponsorId: createDto.sponsorId
          ? new Types.ObjectId(createDto.sponsorId)
          : undefined,
      });

      return await hackOrTip.save();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to create hack or tip');
    }
  }

  async findAll(type?: string, isActive?: boolean): Promise<HackOrTip[]> {
    const filter: any = {};

    if (type) {
      filter.type = type;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    return await this.hackOrTipModel
      .find(filter)
      .populate('sponsorId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<HackOrTip> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    const hackOrTip = await this.hackOrTipModel
      .findById(id)
      .populate('sponsorId')
      .exec();

    if (!hackOrTip) {
      throw new NotFoundException(`Hack or Tip with ID ${id} not found`);
    }

    return hackOrTip;
  }

  async update(
    id: string,
    updateDto: UpdateHackOrTipDto,
  ): Promise<HackOrTip> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    // Validate sponsor ID if provided
    if (updateDto.sponsorId) {
      if (!Types.ObjectId.isValid(updateDto.sponsorId)) {
        throw new BadRequestException('Invalid sponsor ID');
      }
    }

    const updateData: any = { ...updateDto };
    if (updateDto.sponsorId) {
      updateData.sponsorId = new Types.ObjectId(updateDto.sponsorId);
    }

    const hackOrTip = await this.hackOrTipModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('sponsorId')
      .exec();

    if (!hackOrTip) {
      throw new NotFoundException(`Hack or Tip with ID ${id} not found`);
    }

    return hackOrTip;
  }

  async remove(id: string): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    const result = await this.hackOrTipModel.findByIdAndDelete(id).exec();

    if (!result) {
      throw new NotFoundException(`Hack or Tip with ID ${id} not found`);
    }

    return { message: 'Hack or Tip deleted successfully' };
  }

  async findByType(type: string): Promise<HackOrTip[]> {
    return await this.hackOrTipModel
      .find({ type, isActive: true })
      .populate('sponsorId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async toggleActive(id: string): Promise<HackOrTip> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    const hackOrTip = await this.hackOrTipModel.findById(id).exec();

    if (!hackOrTip) {
      throw new NotFoundException(`Hack or Tip with ID ${id} not found`);
    }

    hackOrTip.isActive = !hackOrTip.isActive;
    await hackOrTip.save();

    const updated = await this.hackOrTipModel
      .findById(id)
      .populate('sponsorId')
      .exec();

    if (!updated) {
      throw new NotFoundException(`Hack or Tip with ID ${id} not found`);
    }

    return updated;
  }
}
