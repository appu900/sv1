import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHackCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Sponsor id, or an empty string to remove the sponsor. */
  @IsOptional()
  @IsString()
  sponsorId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value)))
  order?: number;
}
