import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateChallengeDto {
  @IsString()
  @IsNotEmpty()
  communityId: string;

  @IsString()
  @IsNotEmpty()
  challengeName: string;

  startDate: Date;
  endDate: Date;

  @IsString()
  @IsNotEmpty()
  description: string;


  @IsNumber()
  @IsNotEmpty()
  challengeGoals:number;
}
