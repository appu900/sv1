import { PartialType } from '@nestjs/mapped-types';
import { CreateCommunityGroupDto } from './create-community-group.dto';

export class UpdateCommunityGroupDto extends PartialType(CreateCommunityGroupDto) {}
