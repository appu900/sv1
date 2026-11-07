import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

/**
 * Server-side app switches. One document per `key`; the redesign rollout
 * lives under key "redesign" with one rule per area.
 */
@Schema({ timestamps: true, collection: 'app_configs' })
export class AppConfig {
  @Prop({ required: true, unique: true })
  key: string;

  /** Area → { enabled, percent, allowUserIds, minAppVersion }. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  rules: Record<string, unknown>;

  /** Bumped on every save; clients use it to spot changes. */
  @Prop({ default: 1 })
  version: number;

  @Prop()
  updatedBy?: string;
}

export type AppConfigDocument = AppConfig & Document;
export const AppConfigSchema = SchemaFactory.createForClass(AppConfig);
