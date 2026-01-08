import { PartialType } from '@nestjs/mapped-types';
import { CreateFrameworkCategoryDto } from './create-framework-category.dto';

export class UpdateFrameworkCategoryDto extends PartialType(
  CreateFrameworkCategoryDto,
) {}
