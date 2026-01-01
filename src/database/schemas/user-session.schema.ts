import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export class UserSession {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop()
  device: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  lastActivity: Date;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
export type UserSessionDocument = HydratedDocument<UserSession>;

UserSessionSchema.index({ userId: 1 });
UserSessionSchema.index({ lastActivity: -1 });
UserSessionSchema.index(
  { lastActivity: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);
