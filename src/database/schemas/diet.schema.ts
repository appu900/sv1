import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

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
export class DietCategory{
    @Prop({required:true})
    name:string;
}


export type DietCategoryDocument = DietCategory & Document
export const DietCategorySchema = SchemaFactory.createForClass(DietCategory)
