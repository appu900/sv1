import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested, IsNumber, MaxLength, ValidateIf, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";

export class IngredientDto {
    @IsNotEmpty()
    @IsString()
    name!: string;

    @IsNotEmpty()
    @IsNumber()
    averageWeight!: number; 
}

export class SaveFoodDto {
    
    @ValidateIf((o: SaveFoodDto) => !o.ingredients || o.ingredients.length === 0)
    @IsArray()
    @IsNotEmpty({ message: 'Either ingredinatsIds or ingredients must be provided' })
    @ArrayMaxSize(50)
    ingredinatsIds?: string[];

    @IsOptional()
    @IsString()
    frameworkId?: string;

    @ValidateIf((o: SaveFoodDto) => !o.ingredinatsIds || o.ingredinatsIds.length === 0)
    @IsArray()
    @IsNotEmpty({ message: 'Either ingredinatsIds or ingredients must be provided' })
    @ValidateNested({ each: true })
    @Type(() => IngredientDto)
    @ArrayMaxSize(50)
    ingredients?: IngredientDto[];

    @IsOptional()
    @IsString()
    @MaxLength(100)
    idempotencyKey?: string;
}