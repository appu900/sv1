import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

@Schema({timestamps:true})
export class DietCategory{
    @Prop({required:true})
    name:string;
}


export type DietCategoryDocument = DietCategory & Document
export const DietCategorySchema = SchemaFactory.createForClass(DietCategory)
