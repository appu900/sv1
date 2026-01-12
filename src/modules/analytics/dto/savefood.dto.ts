import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";





export class SaveFoodDto{
    @IsNotEmpty()
    @IsArray()
    ingredinatsIds:string[]

    @IsOptional()
    @IsString()
    frameworkId?:string
}