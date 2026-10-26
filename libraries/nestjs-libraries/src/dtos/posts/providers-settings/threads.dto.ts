import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type ThreadsReplyControl =
  | 'everyone'
  | 'accounts_you_follow'
  | 'mentioned_only'
  | 'parent_post_author_only'
  | 'followers_only';

export class ThreadsDto {
  @IsOptional()
  @IsIn([
    'everyone',
    'accounts_you_follow',
    'mentioned_only',
    'parent_post_author_only',
    'followers_only',
  ])
  reply_control?: ThreadsReplyControl;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  topic_tag?: string;
}
