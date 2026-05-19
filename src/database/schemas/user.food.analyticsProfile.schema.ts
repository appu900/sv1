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

    @Prop({default:0, index:true})
    totalAppSessions:number;

    @Prop({ default: [], type: [Types.ObjectId] })
    savedRecipes:Types.ObjectId[]

    @Prop({ default: [], type: [Types.ObjectId] })
    savedHacks:Types.ObjectId[]

    @Prop({ default: [], type: [Types.ObjectId] })
    cookedRecipes:Types.ObjectId[]  
    @Prop({default:0})
    totalMoneySaved:number;

    @Prop({default:0, index:true})
    totalCo2SavedInGrams:number;
}


export type UserFoodAnalyticalProfileDocument = UserFoodAnalyticsProfile & Document
export const UserFoodAnalyticalProfileSchema = SchemaFactory.createForClass(UserFoodAnalyticsProfile)

UserFoodAnalyticalProfileSchema.index({ updatedAt: -1 });
UserFoodAnalyticalProfileSchema.index({ totalMoneySaved: -1, updatedAt: -1 });
UserFoodAnalyticalProfileSchema.index({ foodSavedInGrams: -1, updatedAt: -1 });
UserFoodAnalyticalProfileSchema.index({ totalCo2SavedInGrams: -1, updatedAt: -1 });
UserFoodAnalyticalProfileSchema.index({ numberOfMealsCooked: -1, updatedAt: -1 });