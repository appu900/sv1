import { IsOptional, IsString, Length } from 'class-validator';

export class ScanShoppingListDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  country?: string;
}
