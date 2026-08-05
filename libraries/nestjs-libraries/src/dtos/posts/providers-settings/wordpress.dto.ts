import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { Type } from 'class-transformer';

export class WordpressDto {
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsString()
  @IsDefined()
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  excerpt?: string;

  @IsOptional()
  @IsIn(['publish', 'draft', 'pending', 'private'])
  status?: 'publish' | 'draft' | 'pending' | 'private';

  @IsOptional()
  @IsInt()
  author?: number;

  @IsOptional()
  @IsInt()
  parent?: number;

  @IsOptional()
  @IsInt()
  menu_order?: number;

  @IsOptional()
  @IsIn(['open', 'closed'])
  comment_status?: 'open' | 'closed';

  @IsOptional()
  @IsIn(['open', 'closed'])
  ping_status?: 'open' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  format?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  template?: string;

  @IsOptional()
  @IsBoolean()
  sticky?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  categories?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tags?: number[];

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['none', 'yoast', 'rank_math'])
  seo_plugin?: 'none' | 'yoast' | 'rank_math';

  @IsOptional()
  @IsString()
  seo_title?: string;

  @IsOptional()
  @IsString()
  seo_description?: string;

  @IsOptional()
  @IsString()
  focus_keyword?: string;

  @IsOptional()
  @IsString()
  canonical_url?: string;

  @IsOptional()
  @IsBoolean()
  robots_index?: boolean;

  @IsOptional()
  @IsBoolean()
  robots_follow?: boolean;

  @IsOptional()
  @IsString()
  og_title?: string;

  @IsOptional()
  @IsString()
  og_description?: string;
}
