import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

const toOptionalNumber = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

const toOptionalTrimmedString = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  return value.trim();
};

export class CreateCuisineDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  title: string;

  @Transform(toOptionalTrimmedString)
  @IsString()
  @IsOptional()
  description?: string;

  @Transform(toOptionalNumber)
  @IsNumber()
  @IsOptional()
  order?: number;

  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
