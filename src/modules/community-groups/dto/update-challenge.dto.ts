import { IsNotEmpty, IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';

export class UpdateChallengeDto {
  @IsOptional()
  @IsString()
  challengeName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsOptional()
  @IsNumber()
  challengeGoals?: number;

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
