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

  /**
   * Fruit or vegetable category: throwing one out first suggests ways to use
   * it. Left unset until an admin chooses, so the app can fall back to names.
   */
  @Prop()
  isProduce?: boolean
}


export type IngredientsCategoryDocument = IngredientsCategory & Document
export const ingredinatsCategorySchema = SchemaFactory.createForClass(IngredientsCategory)
