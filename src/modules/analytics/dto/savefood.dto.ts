import { IsArray, IsNotEmpty } from "class-validator";





export class SaveFoodDto{
    @IsNotEmpty()
    @IsArray()
    ingredinatsIds:string[]
}