import { IsNotEmpty, isNotEmpty, IsString } from 'class-validator';

export class JoinChallengeDto {
  @IsString()
  @IsNotEmpty()
  communityId: string;

  @IsString()
  @IsNotEmpty()
  challnageId: string;
}
