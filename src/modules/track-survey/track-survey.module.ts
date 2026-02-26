import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrackSurveyService } from './track-survey.service';
import { TrackSurveyController } from './track-survey.controller';
import {
  TrackSurvey,
  TrackSurveySchema,
} from 'src/database/schemas/track-survey.schema';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';
import { QantasModule } from '../qantas/qantas.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrackSurvey.name, schema: TrackSurveySchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => QantasModule),
  ],
  controllers: [TrackSurveyController],
  providers: [TrackSurveyService],
  exports: [TrackSurveyService],
})
export class TrackSurveyModule {}
