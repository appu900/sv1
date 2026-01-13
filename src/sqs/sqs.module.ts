import { Module,Global } from '@nestjs/common';
import { SqsService } from './sqs.service';
import { SqsController } from './sqs.controller';
import { CacheInvalidationWorkerService } from './cache-invalidation.worker';


@Global()
@Module({
  providers: [SqsService,CacheInvalidationWorkerService],
  controllers: [SqsController],
  exports:[SqsService]
})
export class SqsModule {}
