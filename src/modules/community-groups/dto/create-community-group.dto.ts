import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCommunityGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}

