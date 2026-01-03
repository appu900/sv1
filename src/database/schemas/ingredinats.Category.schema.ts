import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class IngredientsCategory {
  @Prop({ required: true })
  name: string
  
  @Prop({ })
  description?: string;


  @Prop({required:true})
  imageUrl:string
}


export type IngredientsCategoryDocument = IngredientsCategory & Document
export const ingredinatsCategorySchema = SchemaFactory.createForClass(IngredientsCategory)
