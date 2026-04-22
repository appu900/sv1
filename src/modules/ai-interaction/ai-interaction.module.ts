import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AIInteractionEvent,
  AIInteractionEventSchema,
} from '../../database/schemas/ai-interaction-event.schema';
import { AIInteractionService } from './ai-interaction.service';
import { AIInteractionController } from './ai-interaction.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIInteractionEvent.name, schema: AIInteractionEventSchema },
    ]),
  ],
  controllers: [AIInteractionController],
  providers: [AIInteractionService],
  exports: [AIInteractionService],
})
export class AIInteractionModule {}
