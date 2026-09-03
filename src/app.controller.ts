import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@ApiTags('Health')
@Controller()
export class AppController {
  
  constructor(
    private readonly appService: AppService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Hello',
    description:
      'Simple liveness string used by smoke tests. Returns the app hello message. Does not check MongoDB, Redis, or queues.',
  })
  @ApiOkResponse({ description: 'Hello World string.', type: String })
  getHello(): string {
    this.logger.info('Hello endpoint called');
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns `OK` when the HTTP process is up. Does not verify MongoDB, Redis, Stripe, or background queues.',
  })
  @ApiOkResponse({
    description: 'Process is up.',
    schema: { type: 'string', example: 'OK' },
  })
  healthCheck(): string {
    console.log('Health check endpoint accessed');
    this.logger.info('Health check endpoint called');
    return 'OK';
  }
}
