import { Controller, Body, Post } from '@nestjs/common';
import { SqsService } from './sqs.service';

@Controller('sqs')
export class SqsController {
  constructor(private readonly sqsService: SqsService) {}

  @Post('publish-message')
  async publishMessage(@Body() msg: string) {}
}
