import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ShareTypeDto {
  COMMUNITY = 'community',
  PUBLIC = 'public',
}

export class ShareRecipeDto {
  @IsMongoId()
  recipeId: string;

  @IsEnum(ShareTypeDto)
  shareType: ShareTypeDto;

  @IsOptional()
  @IsMongoId()
  communityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}

export class UnshareRecipeDto {
  @IsMongoId()
  sharedRecipeId: string;
}

export class LikeSharedRecipeDto {
  @IsMongoId()
  sharedRecipeId: string;
}

export class SaveSharedRecipeDto {
  @IsMongoId()
  sharedRecipeId: string;
}
