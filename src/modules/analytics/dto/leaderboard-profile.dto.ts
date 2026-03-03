import { IsString, IsOptional, IsBoolean, MaxLength, MinLength } from 'class-validator';

export class JoinLeaderboardDto {
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  displayName: string;
}

export class UpdateLeaderboardProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
