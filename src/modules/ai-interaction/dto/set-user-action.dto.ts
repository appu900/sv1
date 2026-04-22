import { IsEnum } from 'class-validator';
import { AIUserAction } from '../../../database/schemas/ai-interaction-event.schema';

export class SetAiUserActionDto {
  @IsEnum(AIUserAction)
  action: AIUserAction;
}
