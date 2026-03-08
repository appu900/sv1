import { IsString, IsArray, IsOptional, ArrayMinSize } from 'class-validator';

export class GenerateFromIngredientsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ingredients!: string[];

  @IsString()
  @IsOptional()
  preference?: string;
}
