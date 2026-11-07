import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { ArticleBlockDto } from './Create.article.block.dto';

export class UpdateHackDto {
  /** All categories (array, JSON array string or comma list). Primary categoryId is added first. */
  @IsOptional()
  categoryIds?: unknown;

  /** Search keywords (array, JSON array string or comma list). */
  @IsOptional()
  keywords?: unknown;

  /** Ingredient ids the tip is about (array, JSON array string or comma list). */
  @IsOptional()
  ingredientIds?: unknown;

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
  // Keep nested properties intact; validate in service
  articleBlocks?: ArticleBlockDto[];
}
