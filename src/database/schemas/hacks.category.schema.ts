import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Hackscategory {
  @Prop({ required: true, })
  name: string;

  @Prop({ required: true })
  heroImageUrl: string;

  @Prop({ required: true })
  iconImageUrl: string;

  /** Optional "Brought to you by" sponsor for the whole category. */
  @Prop({ type: Types.ObjectId, ref: 'Sponsers' })
  sponsorId?: Types.ObjectId;

  /** Display order in the category grid (lower first). */
  @Prop({ default: 0 })
  order?: number;
}
export type HackCategoryDocument = Hackscategory & Document
export const HacksCategorySchema = SchemaFactory.createForClass(Hackscategory)