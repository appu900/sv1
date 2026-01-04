import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Schema as MongooseSchema } from 'mongoose';

export enum HackOrTipType {
  PRO_TIP = 'Pro Tip',
  MINI_HACK = 'Mini Hack',
  SERVING_SUGGESTION = 'Serving Suggestion',
}

@Schema({ timestamps: true })
export class HackOrTip {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true, enum: Object.values(HackOrTipType) })
  type: HackOrTipType;

  @Prop({ required: true })
  shortDescription: string;

  @Prop({ required: false })
  description: string; 

  @Prop()
  sponsorHeading?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Sponsers' })
  sponsorId?: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;
}

export const HackOrTipSchema = SchemaFactory.createForClass(HackOrTip);

HackOrTipSchema.index({ type: 1 });
HackOrTipSchema.index({ isActive: 1 });
