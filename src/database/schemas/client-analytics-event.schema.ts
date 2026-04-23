import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ClientAnalyticsEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: String, required: true, index: true, maxlength: 120 })
  event: string;

  @Prop({ type: Object, default: {} })
  properties: Record<string, any>;

  @Prop({ type: String, default: null })
  route: string | null;

  @Prop({ type: String, default: null })
  platform: string | null;

  @Prop({ type: String, default: null })
  appVersion: string | null;

  @Prop({ type: String, default: null, index: true })
  sessionId: string | null;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export type ClientAnalyticsEventDocument = ClientAnalyticsEvent & Document;
export const ClientAnalyticsEventSchema =
  SchemaFactory.createForClass(ClientAnalyticsEvent);

ClientAnalyticsEventSchema.index({ event: 1, createdAt: -1 });
ClientAnalyticsEventSchema.index({ userId: 1, createdAt: -1 });
ClientAnalyticsEventSchema.index({ userId: 1, event: 1, createdAt: -1 });
