import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { WordpressDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import slugify from 'slugify';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

type WordpressCredentials = {
  domain: string;
  username: string;
  password: string;
};

type WordpressPostType = { id: string; name: string };
const WORDPRESS_POST_TYPE_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const WORDPRESS_REQUEST_TIMEOUT_MS = 30_000;

export class WordpressProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'wordpress';
  name = 'WordPress';
  isBetweenSteps = false;
  editor = 'html' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 5;
  dto = WordpressDto;

  maxLength() {
    return 100000;
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.indexOf('rest_cannot_create') > -1) {
      return {
        type: 'bad-body',
        value:
          'The connected user has insufficient permissions to create posts',
      };
    }
    return undefined;
  }

  async customFields() {
    return [
      {
        key: 'domain',
        label: 'Domain URL',
        validation: `/^https:\\/\\/(?:www\\.)?[\\w\\-]+(\\.[\\w\\-]+)+([\\/][^\\s?#]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'username',
        label: 'Username',
        validation: `/.+/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Application Password',
        validation: `/.+/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    try {
      const submitted = this.decodeConnectionCode(params.code);
      const body: WordpressCredentials = {
        domain: await this.normalizeAndValidateDomain(submitted.domain),
        username: submitted.username.trim(),
        password: submitted.password.trim(),
      };
      if (!body.username || !body.password) {
        return 'Invalid credentials';
      }

      const auth = Buffer.from(`${body.username}:${body.password}`).toString(
        'base64'
      );
      const response = await fetch(`${body.domain}/wp-json/wp/v2/users/me`, {
        redirect: 'error',
        signal: AbortSignal.timeout(WORDPRESS_REQUEST_TIMEOUT_MS),
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
      if (!response.ok) {
        return 'Invalid credentials';
      }

      const { id, name, avatar_urls, code } = await response.json();
      if (!id || code) {
        return 'Invalid credentials';
      }

      const biggestImage = Object.entries(avatar_urls || {}).reduce(
        (all, current) => Math.max(all, Number(current[0]) || 0),
        0
      );
      const normalizedCode = Buffer.from(JSON.stringify(body)).toString(
        'base64'
      );

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: AuthService.encryptSecret(normalizedCode),
        id: `${body.domain}_${id}`,
        name,
        picture: avatar_urls?.[String(biggestImage)] || '',
        username: body.username,
      };
    } catch {
      return 'Invalid credentials';
    }
  }

  @Tool({
    description: 'Get list of post types',
    dataSchema: [],
  })
  async postTypes(token: string) {
    const body = this.decodeStoredCredentials(token);
    const auth = this.basicAuth(body);
    const postTypes = await (
      await this.wordpressFetch(`${body.domain}/wp-json/wp/v2/types`, {
        headers: { Authorization: `Basic ${auth}` },
      })
    ).json();

    return Object.entries<any>(postTypes).reduce<WordpressPostType[]>(
      (all, [key, value]) => {
        if (
          key.indexOf('wp_') > -1 ||
          key.indexOf('nav_') > -1 ||
          key === 'attachment'
        ) {
          return all;
        }

        const id = String(value?.rest_base || '').trim();
        const name = String(value?.name || '').trim();
        if (!WORDPRESS_POST_TYPE_RE.test(id) || !name || name.length > 100) {
          return all;
        }

        all.push({ id, name });
        return all;
      },
      []
    );
  }

  async post(
    _id: string,
    accessToken: string,
    postDetails: PostDetails<WordpressDto>[],
    _integration: Integration
  ): Promise<PostResponse[]> {
    const body = this.decodeStoredCredentials(accessToken);
    const auth = this.basicAuth(body);
    const requestedType = String(postDetails?.[0]?.settings?.type || '').trim();
    const availablePostTypes = await this.postTypes(accessToken);
    if (!availablePostTypes.some(({ id }) => id === requestedType)) {
      throw new Error('Selected WordPress post type is not available');
    }

    let mediaId = '';
    const mainImagePath = postDetails?.[0]?.settings?.main_image?.path;
    if (mainImagePath) {
      const blob = await this.wordpressFetch(mainImagePath).then((response) =>
        response.blob()
      );
      const filename = this.safeFilename(mainImagePath);
      const mediaUploadResponse = await this.wordpressFetch(
        `${body.domain}/wp-json/wp/v2/media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': blob.type,
          },
          body: blob,
        }
      );
      const mediaResponse = await mediaUploadResponse.json();
      if (!mediaUploadResponse.ok || !mediaResponse?.id) {
        throw new Error(
          String(
            mediaResponse?.message || 'WordPress rejected the featured image'
          )
        );
      }

      mediaId = String(mediaResponse.id);
    }

    const settings = postDetails?.[0]?.settings;
    const seoMeta = this.wordpressSeoMeta(settings);
    const meta = { ...seoMeta, ...(settings?.meta || {}) };
    const requestBody = {
      title: settings?.title,
      content: postDetails?.[0]?.message,
      slug:
        settings?.slug ||
        slugify(settings?.title || '', {
          lower: true,
          strict: true,
          trim: true,
        }),
      status: settings?.status || 'publish',
      ...(settings?.excerpt ? { excerpt: settings.excerpt } : {}),
      ...(typeof settings?.author === 'number' && settings.author > 0
        ? { author: settings.author }
        : {}),
      ...(typeof settings?.parent === 'number' && settings.parent >= 0
        ? { parent: settings.parent }
        : {}),
      ...(typeof settings?.menu_order === 'number' && settings.menu_order >= 0
        ? { menu_order: settings.menu_order }
        : {}),
      ...(settings?.comment_status
        ? { comment_status: settings.comment_status }
        : {}),
      ...(settings?.ping_status ? { ping_status: settings.ping_status } : {}),
      ...(settings?.format ? { format: settings.format } : {}),
      ...(settings?.template ? { template: settings.template } : {}),
      ...(settings?.sticky ? { sticky: true } : {}),
      ...(settings?.password ? { password: settings.password } : {}),
      ...(settings?.categories?.length
        ? { categories: settings.categories }
        : {}),
      ...(settings?.tags?.length ? { tags: settings.tags } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
      ...(mediaId ? { featured_media: Number(mediaId) } : {}),
    };

    const submitResponse = await this.wordpressFetch(
      `${body.domain}/wp-json/wp/v2/${requestedType}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );
    const submit = await submitResponse.json();
    if (!submitResponse.ok || !submit?.id) {
      throw new Error(
        String(submit?.message || 'WordPress did not confirm the publication')
      );
    }

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: String(submit.id),
        releaseURL: submit.link,
      },
    ];
  }

  private decodeConnectionCode(code: string): WordpressCredentials {
    return JSON.parse(
      Buffer.from(code, 'base64').toString()
    ) as WordpressCredentials;
  }

  private decodeStoredCredentials(token: string): WordpressCredentials {
    // Backwards compatibility for WordPress integrations created before the
    // encrypted token format: their token is raw Base64 JSON.
    const encoded = token.startsWith('secret:v1:')
      ? AuthService.decryptSecret(token)
      : token;
    return this.decodeConnectionCode(encoded);
  }

  private basicAuth(credentials: WordpressCredentials): string {
    return Buffer.from(
      `${credentials.username}:${credentials.password}`
    ).toString('base64');
  }

  private async normalizeAndValidateDomain(value: string): Promise<string> {
    const parsed = new URL(String(value || '').trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('Unsafe WordPress URL');
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const normalized = parsed.toString().replace(/\/$/, '');
    if (!(await isSafePublicHttpsUrl(normalized))) {
      throw new Error('Unsafe WordPress URL');
    }
    return normalized;
  }

  private wordpressFetch(url: string, options: RequestInit = {}) {
    return this.fetch(url, {
      ...options,
      redirect: 'error',
      signal:
        options.signal ?? AbortSignal.timeout(WORDPRESS_REQUEST_TIMEOUT_MS),
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
  }

  private safeFilename(value: string): string {
    try {
      return (
        new URL(value).pathname.split('/').pop() || 'featured-image'
      ).replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch {
      return 'featured-image';
    }
  }

  private wordpressSeoMeta(settings?: WordpressDto): Record<string, unknown> {
    if (!settings || settings.seo_plugin === 'none' || !settings.seo_plugin) {
      return {};
    }
    const compact = (value: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([, item]) => item !== undefined && item !== ''
        )
      );

    if (settings.seo_plugin === 'yoast') {
      return compact({
        _yoast_wpseo_title: settings.seo_title,
        _yoast_wpseo_metadesc: settings.seo_description,
        _yoast_wpseo_focuskw: settings.focus_keyword,
        _yoast_wpseo_canonical: settings.canonical_url,
        '_yoast_wpseo_meta-robots-noindex':
          settings.robots_index === false ? '1' : undefined,
        '_yoast_wpseo_meta-robots-nofollow':
          settings.robots_follow === false ? '1' : undefined,
        _yoast_wpseo_opengraph_title: settings.og_title,
        _yoast_wpseo_opengraph_description: settings.og_description,
      });
    }

    return compact({
      rank_math_title: settings.seo_title,
      rank_math_description: settings.seo_description,
      rank_math_focus_keyword: settings.focus_keyword,
      rank_math_canonical_url: settings.canonical_url,
      rank_math_facebook_title: settings.og_title,
      rank_math_facebook_description: settings.og_description,
      rank_math_robots: [
        settings.robots_index === false ? 'noindex' : 'index',
        settings.robots_follow === false ? 'nofollow' : 'follow',
      ],
    });
  }
}
