import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HackOrTipService } from './hack-or-tip.service';
import { HackOrTipController } from './hack-or-tip.controller';
import {
  HackOrTip,
  HackOrTipSchema,
} from '../../database/schemas/hack-or-tip.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HackOrTip.name, schema: HackOrTipSchema },
    ]),
  ],
  controllers: [HackOrTipController],
  providers: [HackOrTipService],
  exports: [HackOrTipService],
})
export class HackOrTipModule {}
