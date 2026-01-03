import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateSponsers {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  broughtToYouBy?: string;

  @IsOptional()
  @IsString()
  tagline?: string;
}
