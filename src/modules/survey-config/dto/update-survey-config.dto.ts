import { PartialType } from '@nestjs/mapped-types';
import { CreateSurveyConfigDto } from './create-survey-config.dto';

export class UpdateSurveyConfigDto extends PartialType(CreateSurveyConfigDto) {}
