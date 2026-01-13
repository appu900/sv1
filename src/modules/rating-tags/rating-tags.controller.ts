import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { RatingTagsService } from './rating-tags.service';
import { CreateRatingTagDto } from './dto/create-rating-tag.dto';
import { UpdateRatingTagDto } from './dto/update-rating-tag.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('rating-tags')
export class RatingTagsController {
  constructor(private readonly ratingTagsService: RatingTagsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createRatingTagDto: CreateRatingTagDto) {
    return this.ratingTagsService.create(createRatingTagDto);
  }

  @Get()
  findAll() {
    return this.ratingTagsService.findAll();
  }

  @Get('active')
  findActive() {
    return this.ratingTagsService.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ratingTagsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() updateRatingTagDto: UpdateRatingTagDto,
  ) {
    return this.ratingTagsService.update(id, updateRatingTagDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.ratingTagsService.remove(id);
  }
}
