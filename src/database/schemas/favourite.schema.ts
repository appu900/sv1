import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Favourite {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  type: string; // 'framework', 'hack', 'recipe'

  @Prop({ required: true })
  framework_id: string; // The ID of the saved item (recipe/hack/framework)

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type FavouriteDocument = Favourite & Document;
export const FavouriteSchema = SchemaFactory.createForClass(Favourite);

// Index for querying user favourites
FavouriteSchema.index({ userId: 1, createdAt: -1 });
// Index for quick lookup of specific favourites
FavouriteSchema.index({ userId: 1, framework_id: 1, type: 1 }, { unique: true });
