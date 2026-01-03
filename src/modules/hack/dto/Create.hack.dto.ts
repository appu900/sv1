import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { ArticleBlockDto } from './Create.article.block.dto';

export class CreateHackDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  sponsorId?: string;

  @IsOptional()
  @IsString()
  leadText?: string;

  @IsOptional()
  @IsString()
  description?: string; 

  @IsArray()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  })
  // Do not apply nested validation here; we validate shape in service logic
  articleBlocks: ArticleBlockDto[];
}
