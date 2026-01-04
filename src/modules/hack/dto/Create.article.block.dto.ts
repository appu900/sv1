import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ArticleBlockType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  LIST = 'list',
  ACCORDION = 'accordion',
  IMAGE_DETAILS = 'image_details',
  HACK_OR_TIP = 'hack_or_tip',
}

export class BaseBlockDto {
  @IsEnum(ArticleBlockType)
  @IsNotEmpty()
  type: ArticleBlockType;

  @IsNotEmpty()
  @IsString()
  id: string;

  @IsOptional()
  order?: number;
}

export class TextBlockDto extends BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  text: string; 
}

export class ImageBlockDto extends BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class VideoBlockDto extends BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  videoUrl: string; // YouTube URL

  @IsOptional()
  @IsString()
  videoCaption?: string;

  @IsOptional()
  @IsString()
  videoCredit?: string;

  @IsOptional()
  @IsString()
  videoThumbnail?: string; // S3 URL for custom thumbnail
}

export class ListItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  listText: string; 
}

export class ListBlockDto extends BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  listTitle: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListItemDto)
  listItems: ListItemDto[];
}

export class AccordionItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  accordionTitle: string;

  @IsString()
  @IsNotEmpty()
  accordionText: string; 

  @IsOptional()
  @IsArray()
  accordionFramework?: string[];
}

export class AccordionBlockDto extends BaseBlockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccordionItemDto)
  accordion: AccordionItemDto[];
}

export class ImageDetailsBlockDto extends BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  blockImageUrl: string;

  @IsString()
  @IsNotEmpty()
  blockTitle: string;

  @IsString()
  @IsNotEmpty()
  blockDescription: string;
}

export class HackOrTipBlockDto extends BaseBlockDto {
  @IsArray()
  @IsString({ each: true })
  hackOrTipIds: string[]; 
}

export type ArticleBlockDto =
  | TextBlockDto
  | ImageBlockDto
  | VideoBlockDto
  | ListBlockDto
  | AccordionBlockDto
  | ImageDetailsBlockDto
  | HackOrTipBlockDto;
