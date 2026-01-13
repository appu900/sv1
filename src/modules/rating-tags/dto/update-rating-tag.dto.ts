import { PartialType } from '@nestjs/mapped-types';
import { CreateRatingTagDto } from './create-rating-tag.dto';

export class UpdateRatingTagDto extends PartialType(CreateRatingTagDto) {}
