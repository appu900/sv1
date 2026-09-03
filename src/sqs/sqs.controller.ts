import { Controller, Body, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { SqsService } from './sqs.service';

@ApiTags('SQS')
@Controller('sqs')
export class SqsController {
  constructor(private readonly sqsService: SqsService) {}

  @Post('publish-message')
  @ApiOperation({
    summary: 'Publish message to SQS',
    description:
      'Public. Accepts a raw string body and is intended to publish it to the configured AWS SQS queue. The handler currently does not call SqsService; the request is accepted as documented. Not an app JWT route.',
  })
  @ApiBody({
    description: 'Raw message string published to the SQS queue.',
    schema: { type: 'string' },
  })
  @ApiCreatedResponse({
    description: 'Request accepted. Current handler returns no body.',
  })
  async publishMessage(@Body() msg: string) {}
}
