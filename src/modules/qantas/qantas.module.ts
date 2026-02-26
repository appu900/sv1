import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { QantasService } from './qantas.service';
import { QantasController } from './qantas.controller';
import { QantasCronService } from './qantas-cron.service';
import { QantasApiClient } from './qantas-api-client';
import { QantasFFN, QantasFFNSchema } from 'src/database/schemas/qantas-ffn.schema';
import {
  QantasPointsAllocation,
  QantasPointsAllocationSchema,
} from 'src/database/schemas/qantas-points-allocation.schema';
import { TrackSurvey, TrackSurveySchema } from 'src/database/schemas/track-survey.schema';
import { User, UserSchema } from 'src/database/schemas/user.auth.schema';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: QantasFFN.name, schema: QantasFFNSchema },
      { name: QantasPointsAllocation.name, schema: QantasPointsAllocationSchema },
      { name: TrackSurvey.name, schema: TrackSurveySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [QantasController],
  providers: [QantasApiClient, QantasService, QantasCronService],
  exports: [QantasService],
})
export class QantasModule {}
