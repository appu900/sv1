import { IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ArticleBlockDto } from './Create.article.block.dto';

export class UpdateHackDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  sponsorId?: string;

  @IsOptional()
  @IsString()
  leadText?: string; 

  @IsOptional()
  @IsString()
  description?: string; 

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  articleBlocks?: ArticleBlockDto[];
}
