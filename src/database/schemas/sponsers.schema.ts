import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Sponsers {


  @Prop({required:true})
  title: string;

  @Prop({required:true})
  logo: string;

  @Prop({required:true})
  logoBlackAndWhite: string;

  @Prop({required:false})
  broughtToYouBy: string;

  @Prop({required:false})
  tagline: string;
}


export type SponsersDocument = Sponsers & Document
export const SponsersSchema = SchemaFactory.createForClass(Sponsers)
