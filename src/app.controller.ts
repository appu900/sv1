import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
@Controller()
export class AppController {
  
  constructor(
    private readonly appService: AppService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: Logger
  ) {}

  @Get()
  getHello(): string {
    this.logger.info('Hello endpoint called');
    return this.appService.getHello();
  }

  @Get('health')
  healthCheck(): string {
    console.log('Health check endpoint accessed');
    this.logger.info('Health check endpoint called');
    return 'OK';
  }
}
