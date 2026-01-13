import { PartialType } from '@nestjs/mapped-types';
import { CreateBadgeDto } from './create-badge.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateBadgeDto extends PartialType(CreateBadgeDto) {
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;
}
