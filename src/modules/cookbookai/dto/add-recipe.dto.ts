import { IsString, IsNotEmpty } from 'class-validator';

export class AddRecipeDto {
  @IsString()
  @IsNotEmpty()
  message!: string;
}
