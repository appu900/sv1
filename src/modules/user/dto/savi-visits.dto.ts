import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class SaviVisitIncrementsDto {
  @ApiProperty({
    description:
      'Screen key → number of new visits since the last sync. Keys match ^[a-z0-9_]{1,40}$, values are 1–50, at most 32 keys per request.',
    example: { kitchen_home: 2, kitchen_receipt: 1 },
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 1, maximum: 50 },
  })
  @IsObject()
  increments: Record<string, number>;
}
