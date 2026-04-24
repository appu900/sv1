import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';


export class SyncSubscriptionDto {
  @IsObject()
  @IsNotEmpty()
  customerInfo: Record<string, any>;

  @IsOptional()
  @IsString()
  revenueCatUserId?: string;
}
