import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEnum(['ios', 'android'])
  platform: 'ios' | 'android';

  @IsEnum(['apns', 'fcm'])
  tokenType: 'apns' | 'fcm';

  @IsOptional()
  @IsEnum(['prod', 'dev'])
  tokenMode?: 'prod' | 'dev';

  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  appBuild?: string;

  @IsOptional()
  @IsString()
  appBundle?: string;
}

export class UnregisterTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
