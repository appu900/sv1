import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Schema as MongooseSchema } from 'mongoose';

// Article Block Schemas (stored as subdocuments)
@Schema({ _id: true })
export class TextBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  text: string; // HTML formatted
}

@Schema({ _id: true })
export class ImageBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop()
  caption?: string;
}

@Schema({ _id: true })
export class VideoBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  videoUrl: string;

  @Prop()
  videoCaption?: string;

  @Prop()
  videoCredit?: string;

  @Prop()
  thumbnailUrl?: string;
}

@Schema({ _id: false })
export class ListItem {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  listText: string; // HTML formatted
}

@Schema({ _id: true })
export class ListBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  listTitle: string;

  @Prop({ type: [ListItem] })
  listItems: ListItem[];
}

@Schema({ _id: false })
export class AccordionItem {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  accordionTitle: string;

  @Prop({ required: true })
  accordionText: string; // HTML formatted

  @Prop({ type: [String] })
  accordionFramework?: string[];
}

@Schema({ _id: true })
export class AccordionBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ type: [AccordionItem] })
  accordion: AccordionItem[];
}

@Schema({ _id: true })
export class ImageDetailsBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  blockImageUrl: string;

  @Prop({ required: true })
  blockTitle: string;

  @Prop({ required: true })
  blockDescription: string;
}

@Schema({ _id: true })
export class HackOrTipBlock {
  @Prop({ required: true })
  type: string;

  @Prop({ type: [String] })
  hackOrTipIds: string[];
}

@Schema({ timestamps: true })
export class Hacks {
  @Prop({ required: true, index: true })
  title: string;

  @Prop()
  shortDescription?: string;

  @Prop()
  description?: string; // Main summary/description (HTML)

  @Prop()
  thumbnailImageUrl?: string; // For card display

  @Prop()
  heroImageUrl?: string; // For detail page header

  @Prop()
  iconImageUrl?: string; // Category icon

  @Prop()
  leadText?: string; // HTML formatted lead text

  @Prop({ type: Types.ObjectId, index: true })
  sponsorId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  categoryId: Types.ObjectId;

  // Article blocks stored as an array of mixed schema types
  @Prop({
    type: [MongooseSchema.Types.Mixed],
    default: [],
  })
  articleBlocks: Array<
    | TextBlock
    | ImageBlock
    | VideoBlock
    | ListBlock
    | AccordionBlock
    | ImageDetailsBlock
    | HackOrTipBlock
  >;

  @Prop({ default: 0 })
  order?: number; // For sequential rendering/display order
}

export type HackDocument = Hacks & Document;
export const HackSchema = SchemaFactory.createForClass(Hacks);