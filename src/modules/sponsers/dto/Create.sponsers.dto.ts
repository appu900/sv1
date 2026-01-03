import { IsNotEmpty, IsString } from 'class-validator';

export class CreateSponsers {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  broughtToYouBy: string;

  @IsNotEmpty()
  @IsString()
  tagline: string;
}
