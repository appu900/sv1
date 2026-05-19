import { IsString, IsNotEmpty } from 'class-validator';

export class CreateFavouriteDto {
  @IsString()
  @IsNotEmpty()
  type: string; 

  @IsString()
  @IsNotEmpty()
  framework_id: string;
}
