import { IsString, IsNotEmpty } from 'class-validator';

export class CreateFavouriteDto {
  @IsString()
  @IsNotEmpty()
  type: string; // 'framework', 'hack', 'recipe'

  @IsString()
  @IsNotEmpty()
  framework_id: string;
}
