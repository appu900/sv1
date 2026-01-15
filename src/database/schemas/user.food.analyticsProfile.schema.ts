
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose"
@Schema({timestamps:true})
export class UserFoodAnalyticsProfile{
    @Prop({type:Types.ObjectId,index:true,ref:'User'})
    userId:Types.ObjectId
    
    @Prop({default:0, index:true}) 
    numberOfMealsCooked:number;

    @Prop({default:0, index:true}) 
    foodSavedInGrams:number;

    @Prop({default:[]})
    savedRecipes:Types.ObjectId[]

    @Prop({default:[], type:[String]})
    cookedRecipes:string[]  
    @Prop({default:0})
    totalMoneySaved:number;
}


export type UserFoodAnalyticalProfileDocument = UserFoodAnalyticsProfile & Document
export const UserFoodAnalyticalProfileSchema = SchemaFactory.createForClass(UserFoodAnalyticsProfile)