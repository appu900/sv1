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

  @IsEnum(['apns', 'fcm', 'expo'])
  tokenType: 'apns' | 'fcm' | 'expo';

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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  installationId?: string;
}

export class UnregisterTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
