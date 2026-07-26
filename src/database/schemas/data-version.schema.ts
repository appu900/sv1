import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';


@Schema({ timestamps: true, collection: 'dataversions' })
export class DataVersion {
  @Prop({ required: true, unique: true, index: true })
  collectionKey: string;

  @Prop({ required: true, default: 0 })
  version: number;
}

export type DataVersionDocument = DataVersion & Document;
export const DataVersionSchema = SchemaFactory.createForClass(DataVersion);
