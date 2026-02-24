import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested, IsNumber } from "class-validator";
import { Type } from "class-transformer";





export class SaveFoodDto{
    @IsOptional()
    @IsArray()
    ingredinatsIds:string[]

    @IsOptional()
    @IsString()
    frameworkId?:string

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => IngredientDto)
    ingredients?: IngredientDto[]
}

export class IngredientDto {
    @IsNotEmpty()
    @IsString()
    name!: string;

    @IsNotEmpty()
    @IsNumber()
    averageWeight!: number; // grams
}