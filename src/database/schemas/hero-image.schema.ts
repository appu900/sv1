import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';


@Schema({ _id: false })
export class HeroImage {
  @Prop({ required: true })
  base: string;
  @Prop({ type: Object, default: {} })
  variants: Record<string, string>;

  @Prop({ default: 0 })
  width: number;

  @Prop({ default: 0 })
  height: number;

  @Prop({ default: '' })
  thumbhash: string;
}

export const HeroImageSchema = SchemaFactory.createForClass(HeroImage);
