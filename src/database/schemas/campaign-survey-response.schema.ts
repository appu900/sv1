import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/** One user's completed campaign survey (e.g. the Christmas Food Report). */
@Schema({ timestamps: true, collection: 'campaign_survey_responses' })
export class CampaignSurveyResponse {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  campaignId: string;

  /** One entry per question: option ids, their labels, and any "Other" text. */
  @Prop({
    type: [
      {
        _id: false,
        questionId: { type: String, required: true },
        selected: { type: [String], default: [] },
        labels: { type: [String], default: [] },
        other: { type: String },
      },
    ],
    default: [],
  })
  answers: { questionId: string; selected: string[]; labels: string[]; other?: string }[];

  /** Normalised country at the time of answering. */
  @Prop({ type: String })
  country?: string;

  @Prop({ type: Date, required: true })
  completedAt: Date;

  /**
   * Set when the thank-you is activated. `plan` is null for members who were
   * already on Legend (thank-you only).
   */
  @Prop({
    type: {
      _id: false,
      plan: { type: String, enum: ['hero', 'legend', null], default: null },
      activatedAt: { type: Date },
      expiresAt: { type: Date },
    },
    default: null,
  })
  gift?: { plan: 'hero' | 'legend' | null; activatedAt: Date; expiresAt?: Date } | null;
}

export type CampaignSurveyResponseDocument = CampaignSurveyResponse & Document;
export const CampaignSurveyResponseSchema = SchemaFactory.createForClass(CampaignSurveyResponse);
CampaignSurveyResponseSchema.index({ userId: 1, campaignId: 1 }, { unique: true });
