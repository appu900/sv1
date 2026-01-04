import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ 
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret: any) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
})
export class IngredientsCategory {
  @Prop({ required: true })
  name: string

  @Prop()
  imageUrl?: string
}


export type IngredientsCategoryDocument = IngredientsCategory & Document
export const ingredinatsCategorySchema = SchemaFactory.createForClass(IngredientsCategory)
