import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { randomBytes } from 'node:crypto';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { capitalize } from 'lodash';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { Integration } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { ThreadsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/threads.dto';
import type { ThreadsReplyControl } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/threads.dto';
import { decryptMetaProviderToken } from '@gitroom/nestjs-libraries/integrations/social/meta.token';

export class ThreadsProvider extends SocialAbstract implements SocialProvider {
  identifier = 'threads';
  name = 'Threads';
  isBetweenSteps = false;
  scopes = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_replies',
    // 'threads_profile_discovery',
  ];
  override maxConcurrentJob = 2; // Threads has moderate rate limits
  refreshCron = true;
  dto = ThreadsDto;

  editor = 'normal' as const;
  maxLength() {
    return 500;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    for (const media of posts) {
      if (media.length > 20) {
        return 'Threads supports at most 20 media items per post';
      }
      if (
        media.some(
          (item) =>
            !hasExtension(item.path, 'mp4') &&
            !hasExtension(item.path, 'jpg') &&
            !hasExtension(item.path, 'jpeg') &&
            !hasExtension(item.path, 'png')
        )
      ) {
        return 'Threads supports JPG, PNG, or MP4 media';
      }
    }
    return true;
  }

  private appCredentials() {
    const appId = process.env.THREADS_APP_ID?.trim();
    const appSecret = process.env.THREADS_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new Error(
        'Threads OAuth is not configured: THREADS_APP_ID and THREADS_APP_SECRET are required'
      );
    }
    return { appId, appSecret };
  }

  private oauthRedirectUri() {
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
    if (!frontendUrl) {
      throw new Error(
        'Threads OAuth is not configured: FRONTEND_URL is required'
      );
    }
    const publicUrl = frontendUrl.startsWith('https://')
      ? frontendUrl
      : `https://redirectmeto.com/${frontendUrl}`;
    return `${publicUrl}/integrations/social/threads`;
  }

  private publicationOptions(settings?: ThreadsDto) {
    const topicTag = settings?.topic_tag?.trim().replace(/^#+/, '');
    return {
      ...(settings?.reply_control
        ? { reply_control: settings.reply_control as ThreadsReplyControl }
        : {}),
      ...(topicTag ? { topic_tag: topicTag } : {}),
    };
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('Error validating access token')) {
      return { type: 'refresh-token', value: 'Threads access token expired' };
    }

    if (body.includes('2207051')) {
      return {
        type: 'bad-body',
        value:
          'Error from Meta: We restrict certain activity to protect our community',
      };
    }

    if (body.includes('4279013')) {
      return {
        type: 'bad-body',
        value: 'User restricted',
      };
    }
    if (body.includes('The media could not be fetched from this URI')) {
      return {
        type: 'bad-body',
        value:
          "One of the media URLs is invalid or inaccessible, make sure it's being uploaded to Postiz first",
      };
    }
    if (body.includes('text must be at most 500 characters')) {
      return {
        type: 'bad-body',
        value: 'Post text exceeds 500 characters limit',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    refresh_token = decryptMetaProviderToken(refresh_token);
    const { access_token } = await (
      await this.fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${refresh_token}`
      )
    ).json();

    const { id, name, username, picture } = await this.fetchUserInfo(
      access_token
    );

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: picture || '',
      username,
    };
  }

  async generateAuthUrl() {
    const { appId } = this.appCredentials();
    const state = randomBytes(24).toString('base64url');
    return {
      url:
        'https://www.threads.net/oauth/authorize' +
        `?client_id=${encodeURIComponent(appId)}` +
        `&redirect_uri=${encodeURIComponent(this.oauthRedirectUri())}` +
        `&state=${state}` +
        '&response_type=code' +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: randomBytes(32).toString('base64url'),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { appId, appSecret } = this.appCredentials();
    const getAccessToken = await (
      await this.fetch(
        'https://graph.threads.net/oauth/access_token' +
          `?client_id=${encodeURIComponent(appId)}` +
          `&redirect_uri=${encodeURIComponent(this.oauthRedirectUri())}` +
          `&grant_type=authorization_code` +
          `&client_secret=${encodeURIComponent(appSecret)}` +
          `&code=${encodeURIComponent(params.code)}`
      )
    ).json();

    const { access_token } = await (
      await this.fetch(
        'https://graph.threads.net/access_token' +
          '?grant_type=th_exchange_token' +
          `&client_secret=${encodeURIComponent(appSecret)}` +
          `&access_token=${encodeURIComponent(getAccessToken.access_token)}`
      )
    ).json();

    const { id, name, username, picture } = await this.fetchUserInfo(
      access_token
    );

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(58, 'days').unix() - dayjs().unix(),
      picture: picture || '',
      username: username,
    };
  }

  private async checkLoaded(
    mediaContainerId: string,
    accessToken: string,
    attempt = 0
  ): Promise<boolean> {
    const { status, error_message } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${mediaContainerId}?fields=status,error_message&access_token=${accessToken}`
      )
    ).json();

    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ status, error_message }),
        '{}',
        error_message ||
          (status === 'EXPIRED'
            ? 'Threads media container expired before publishing'
            : 'Threads could not process the media')
      );
    }

    if (status === 'FINISHED') {
      await timer(2000);
      return true;
    }

    if (attempt >= 29) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ status }),
        '{}',
        'Threads media processing timed out. Try publishing again later.'
      );
    }

    await timer(2200);
    return this.checkLoaded(mediaContainerId, accessToken, attempt + 1);
  }

  private async fetchUserInfo(accessToken: string) {
    const { id, username, threads_profile_picture_url } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name: username,
      picture: threads_profile_picture_url || '',
      username,
    };
  }

  private async createSingleMediaContent(
    userId: string,
    accessToken: string,
    media: { path: string },
    message: string,
    isCarouselItem = false,
    replyToId?: string,
    settings?: ThreadsDto
  ): Promise<string> {
    const mediaType = hasExtension(media.path, 'mp4')
      ? 'video_url'
      : 'image_url';
    const mediaParams = new URLSearchParams({
      ...(mediaType === 'video_url' ? { video_url: media.path } : {}),
      ...(mediaType === 'image_url' ? { image_url: media.path } : {}),
      ...(isCarouselItem ? { is_carousel_item: 'true' } : {}),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      ...this.publicationOptions(settings),
      media_type: mediaType === 'video_url' ? 'VIDEO' : 'IMAGE',
      ...(message ? { text: message } : {}),
      access_token: accessToken,
    });

    const { id: mediaId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads?${mediaParams.toString()}`,
        {
          method: 'POST',
        }
      )
    ).json();

    return mediaId;
  }

  private async createCarouselContent(
    userId: string,
    accessToken: string,
    media: { path: string }[],
    message: string,
    replyToId?: string,
    settings?: ThreadsDto
  ): Promise<string> {
    // Create each media item
    const mediaIds = [];
    for (const mediaItem of media) {
      const mediaId = await this.createSingleMediaContent(
        userId,
        accessToken,
        mediaItem,
        '',
        true
      );
      mediaIds.push(mediaId);
    }

    // Wait for all media to be loaded
    await Promise.all(
      mediaIds.map((id: string) => this.checkLoaded(id, accessToken))
    );

    // Create carousel container
    const params = new URLSearchParams({
      text: message,
      media_type: 'CAROUSEL',
      children: mediaIds.join(','),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      ...this.publicationOptions(settings),
      access_token: accessToken,
    });

    const { id: containerId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads?${params.toString()}`,
        {
          method: 'POST',
        }
      )
    ).json();

    return containerId;
  }

  private async createTextContent(
    userId: string,
    accessToken: string,
    message: string,
    replyToId?: string,
    quoteId?: string,
    settings?: ThreadsDto
  ): Promise<string> {
    const form = new FormData();
    form.append('media_type', 'TEXT');
    form.append('text', message);
    form.append('access_token', accessToken);

    if (replyToId) {
      form.append('reply_to_id', replyToId);
    }

    if (quoteId) {
      form.append('quote_post_id', quoteId);
    }

    for (const [key, value] of Object.entries(
      this.publicationOptions(settings)
    )) {
      form.append(key, value);
    }

    const { id: contentId, ...all } = await (
      await this.fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
        method: 'POST',
        body: form,
      })
    ).json();

    return contentId;
  }

  private async publishThread(
    userId: string,
    accessToken: string,
    creationId: string,
    integration: Integration
  ): Promise<{ threadId: string; permalink: string }> {
    await this.checkLoaded(creationId, accessToken);

    const { id: threadId } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${creationId}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    let permalink = integration.profile
      ? `https://www.threads.net/@${integration.profile}`
      : 'https://www.threads.net/';
    try {
      const result = await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${threadId}?fields=id,permalink&access_token=${accessToken}`
        )
      ).json();
      permalink = result.permalink || permalink;
    } catch {
      // Publishing already succeeded. A cosmetic permalink lookup must never
      // make the job retry and create a duplicate Thread.
    }

    return { threadId, permalink };
  }

  private async createThreadContent(
    userId: string,
    accessToken: string,
    postDetails: PostDetails,
    replyToId?: string,
    quoteId?: string
  ): Promise<string> {
    // Handle content creation based on media type
    if (!postDetails.media || postDetails.media.length === 0) {
      // Text-only content
      return await this.createTextContent(
        userId,
        accessToken,
        postDetails.message,
        replyToId,
        quoteId,
        postDetails.settings
      );
    } else if (postDetails.media.length === 1) {
      // Single media content
      return await this.createSingleMediaContent(
        userId,
        accessToken,
        postDetails.media[0],
        postDetails.message,
        false,
        replyToId,
        postDetails.settings
      );
    } else {
      // Carousel content
      return await this.createCarouselContent(
        userId,
        accessToken,
        postDetails.media,
        postDetails.message,
        replyToId,
        postDetails.settings
      );
    }
  }

  async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails<ThreadsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    accessToken = decryptMetaProviderToken(accessToken);
    if (!postDetails.length) {
      return [];
    }

    const [firstPost] = postDetails;

    // Create the initial thread
    const initialContentId = await this.createThreadContent(
      userId,
      accessToken,
      firstPost
    );

    // Publish the thread
    const { threadId, permalink } = await this.publishThread(
      userId,
      accessToken,
      initialContentId,
      integration
    );

    // Return the main post response
    return [
      {
        id: firstPost.id,
        postId: threadId,
        status: 'success',
        releaseURL: permalink,
      },
    ];
  }

  async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<ThreadsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    accessToken = decryptMetaProviderToken(accessToken);
    if (!postDetails.length) {
      return [];
    }

    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    // Create reply content
    const replyContentId = await this.createThreadContent(
      userId,
      accessToken,
      commentPost,
      replyToId
    );

    // Publish the reply
    const { threadId: replyThreadId, permalink } = await this.publishThread(
      userId,
      accessToken,
      replyContentId,
      integration
    );

    return [
      {
        id: commentPost.id,
        postId: replyThreadId,
        status: 'success',
        releaseURL: permalink,
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    accessToken = decryptMetaProviderToken(accessToken);
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${id}/threads_insights?metric=views,likes,replies,reposts,quotes&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    return (
      data?.map((d: any) => ({
        label: capitalize(d.name),
        percentageChange: 5,
        data: d.total_value
          ? [{ total: d.total_value.value, date: dayjs().format('YYYY-MM-DD') }]
          : d.values.map((v: any) => ({
              total: v.value,
              date: dayjs(v.end_time).format('YYYY-MM-DD'),
            })),
      })) || []
    );
  }

  @Plug({
    identifier: 'threads-autoPlugPost',
    title: 'Auto plug post',
    description:
      'When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
      {
        name: 'post',
        type: 'richtext',
        placeholder: 'Post to plug',
        description: 'Message content to plug',
        validation: /^[\s\S]{3,}$/g,
      },
    ],
  })
  async autoPlugPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string; post: string }
  ) {
    const accessToken = decryptMetaProviderToken(integration.token);
    const { data } = await (
      await this.fetch(
        `https://graph.threads.net/v1.0/${id}/insights?metric=likes&access_token=${accessToken}`
      )
    ).json();

    const {
      values: [value],
    } = data.find((p: any) => p.name === 'likes');

    if (value.value >= fields.likesAmount) {
      await timer(2000);

      const form = new FormData();
      form.append('media_type', 'TEXT');
      form.append('text', stripHtmlValidation('normal', fields.post, true));
      form.append('reply_to_id', id);
      form.append('access_token', accessToken);

      const { id: replyId } = await (
        await this.fetch('https://graph.threads.net/v1.0/me/threads', {
          method: 'POST',
          body: form,
        })
      ).json();

      await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${integration.internalId}/threads_publish?creation_id=${replyId}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();
      return true;
    }

    return false;
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    accessToken = decryptMetaProviderToken(accessToken);
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch thread insights from Threads API
      const { data } = await (
        await this.fetch(
          `https://graph.threads.net/v1.0/${postId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value ?? metric.total_value?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'replies':
            label = 'Replies';
            break;
          case 'reposts':
            label = 'Reposts';
            break;
          case 'quotes':
            label = 'Quotes';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Threads post analytics:', err);
      return [];
    }
  }

  // override async mention(
  //   token: string,
  //   data: { query: string },
  //   id: string,
  //   integration: Integration
  // ) {
  //   const p = await (
  //     await fetch(
  //       `https://graph.threads.net/v1.0/profile_lookup?username=${data.query}&access_token=${integration.token}`
  //     )
  //   ).json();
  //
  //   return [
  //     {
  //       id: String(p.id),
  //       label: p.name,
  //       image: p.profile_picture_url,
  //     },
  //   ];
  // }
  //
  // mentionFormat(idOrHandle: string, name: string) {
  //   return `@${idOrHandle}`;
  // }
}
