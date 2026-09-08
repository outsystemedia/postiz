import { createHash } from 'node:crypto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CredentialConnection, CredentialError } from '@gitroom/nestjs-libraries/integrations/credentials/credential.connection';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { ChangePostStatusDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.status.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { UploadDto } from '@gitroom/nestjs-libraries/dtos/media/upload.dto';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@gitroom/nestjs-libraries/dtos/notifications/get.notifications.dto';
import { Readable } from 'stream';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const PUBLIC_API_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);
import * as Sentry from '@sentry/nestjs';
import {
  socialIntegrationList,
  IntegrationManager,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicIntegrationsController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    const getFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path
    );
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const response = await fetch(body.url, {
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
    if (!response.ok) {
      throw new HttpException({ msg: 'Failed to fetch URL' }, 400);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const detected = await fromBuffer(buffer);
    if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException({ msg: 'Unsupported file type.' }, 400);
    }
    const mimetype = detected.mime;
    const ext = detected.ext;

    const getFile = await this.storage.uploadFile({
      buffer,
      mimetype,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${ext}`,
      encoding: '',
    });

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path
    );
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/posts')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const posts = await this._postsService.getPosts(org.id, query);
    return {
      posts,
      // comments,
    };
  }

  @Post('/posts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const body = await this._postsService.mapTypeToPost(
      rawBody,
      org.id,
      rawBody?.type === 'draft' || true
    );
    body.type = rawBody.type;

    if (
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      body.posts.some((p) =>
        p.value.some((a) =>
          a.image.some(
            (i) => i.path.indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) === -1
          )
        )
      )
    ) {
      throw new HttpException(
        {
          msg: `All media must be uploaded through our upload API route and contain the domain: ${process.env.RESTRICT_UPLOAD_DOMAINS}`,
        },
        400
      );
    }

    // Server-side validation — same rules as the dashboard, surfaced as a
    // readable 400 (see PostValidationExceptionFilter).
    const validation = await this._postsService.validatePosts(
      org.id,
      body.posts
    );

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(
          item,
          'Your post should have at least one character or one image.'
        );
      }
    }

    if (body.type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }

    const allowedCreationMethods = ['CLI', 'API'] as const;
    const creationMethod = allowedCreationMethods.includes(
      rawBody.creationMethod
    )
      ? (rawBody.creationMethod as 'CLI' | 'API')
      : 'API';

    return this._postsService.createPost(org.id, body, creationMethod);
  }

  @Delete('/posts/:id')
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getPostById = await this._postsService.getPost(org.id, id);
    return this._postsService.deletePost(org.id, getPostById.group);
  }

  @Delete('/posts/group/:group')
  deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deletePost(org.id, group);
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { connected: true };
  }

  /**
   * DesignerPRO capability handshake. Keeping this opt-in means a caller can
   * fail closed while an older Postiz deployment is still running instead of
   * silently publishing a WordPress article without its inline media.
   */
  @Get('/capabilities')
  async getPublicationCapabilities(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { wordpressInlineMedia: true };
  }

  @Get('/groups')
  async listGroups(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.customers(org.id)).map(
      (customer) => ({
        id: customer.id,
        name: customer.name,
      })
    );
  }

  @Get('/integrations')
  async listIntegration(
    @GetOrgFromRequest() org: Organization,
    @Query('group') group?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.getIntegrationsList(org.id))
      .filter((integration) => !group || integration.customer?.id === group)
      .map((integration) => ({
        id: integration.id,
        name: integration.name,
        identifier: integration.providerIdentifier,
        picture: integration.picture,
        disabled: integration.disabled,
        profile: integration.profile,
        customer: integration.customer
          ? {
              id: integration.customer.id,
              name: integration.customer.name,
            }
          : undefined,
      }));
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        {
          msg: 'This integration requires an external URL and is not supported via the public API',
        },
        400
      );
    }

    try {
      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
      await ioRedis.set(`integration:${state}`, integration, 'EX', 3600);

      // DesignerPRO addition: `state` is handed back so the caller can poll
      // GET /social/state/:state below for the exact integration id this
      // attempt resolves to, instead of diffing GET /integrations snapshots.
      return { url, state };
    } catch (err) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  /**
   * DesignerPRO addition — completes the credential-based WordPress flow
   * without exposing Postiz's internal no-auth callback to the caller.
   * The state is both organization- and provider-bound by getIntegrationUrl.
   */
  @Post('/social/:provider/credentials')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async connectCredentials(@GetOrgFromRequest() org: Organization, @Param('provider') provider: string,
    @Body() body: { groupId?: string; credentials?: Record<string, string> }) {
    const connection: CredentialConnection | undefined = (this._integrationManager.getSocialIntegration(provider) as any)?.credentialConnection;
    if (!connection) throw new HttpException({ msg: 'Este canal não aceita conexão por credenciais.' }, 400);
    if (typeof body?.groupId !== 'string' || !body.groupId || body.groupId.length > 200 ||
        !body.credentials || Array.isArray(body.credentials) || typeof body.credentials !== 'object' ||
        Object.keys(body.credentials).length > 12 || Object.values(body.credentials).some(v => typeof v !== 'string' || v.length > 8192)) {
      throw new HttpException({ msg: 'Dados de conexão inválidos.' }, 400);
    }
    if (!(await this._integrationService.getCustomer(org.id, body.groupId))) throw new HttpException({ msg: 'Marca não encontrada.' }, 404);
    try {
      const auth = await connection.authenticate(body.credentials);
      if (!auth.id || !auth.name) throw new CredentialError('Não foi possível validar a conta.');
      const internalId = 'credentials:' + createHash('sha256').update(JSON.stringify([provider, body.groupId, auth.id])).digest('hex');
      const token = AuthService.encryptSecret(JSON.stringify({ ...auth, version: 1, provider }));
      const saved = await this._integrationService.saveCredentialIntegration(org.id, body.groupId, internalId, provider, auth.name, auth.username, token);
      return { status: 'connected', integration: { id: saved.id, name: saved.name, identifier: saved.providerIdentifier, picture: null } };
    } catch (err) {
      // Never forward SDK exceptions: they can contain headers, URLs and keys.
      throw new HttpException({ msg: err instanceof CredentialError ? err.message : 'Não foi possível validar a conexão. Verifique os dados e tente novamente.' }, err instanceof CredentialError ? err.status : 502);
    }
  }

  @Post('/social/wordpress/connect')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async connectWordpress(
    @GetOrgFromRequest() org: Organization,
    @Body()
    body: {
      state?: string;
      domain?: string;
      username?: string;
      password?: string;
      timezone?: string;
    }
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const state = String(body?.state || '').trim();
    const domain = String(body?.domain || '').trim();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    const timezone = Number(body?.timezone || 0);
    if (
      !state ||
      !domain ||
      !username ||
      !password ||
      state.length > 200 ||
      domain.length > 2048 ||
      username.length > 200 ||
      password.length > 512 ||
      !Number.isFinite(timezone) ||
      Math.abs(timezone) > 1440
    ) {
      throw new HttpException(
        { msg: 'Invalid WordPress connection data' },
        400
      );
    }

    const [orgForState, providerForState, loginForState] = await Promise.all([
      ioRedis.get(`organization:${state}`),
      ioRedis.get(`integration:${state}`),
      ioRedis.get(`login:${state}`),
    ]);
    if (
      orgForState !== org.id ||
      providerForState !== 'wordpress' ||
      !loginForState
    ) {
      throw new HttpException({ msg: 'State not found' }, 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration('wordpress');
    const code = Buffer.from(
      JSON.stringify({ domain, username, password })
    ).toString('base64');
    const auth = await integrationProvider.authenticate({
      code,
      codeVerifier: 'none',
    });
    if (typeof auth === 'string' || !auth.id || !auth.accessToken) {
      throw new HttpException(
        { msg: 'Invalid WordPress credentials or URL' },
        400
      );
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        auth.additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        String(auth.name || auth.username || 'WordPress').trim(),
        auth.picture,
        'social',
        String(auth.id),
        'wordpress',
        auth.accessToken,
        auth.refreshToken,
        auth.expiresIn,
        auth.username,
        false,
        undefined,
        timezone
      );

    this._refreshIntegrationService
      .startRefreshWorkflow(org.id, createUpdate.id, integrationProvider)
      .catch(() => undefined);

    const result = {
      id: createUpdate.id,
      name: createUpdate.name,
      identifier: createUpdate.providerIdentifier,
      picture: createUpdate.picture ?? null,
    };
    await Promise.all([
      ioRedis.set(`connect-result:${state}`, JSON.stringify(result), 'EX', 600),
      ioRedis.del(`login:${state}`),
    ]);

    return { status: 'connected' as const, integration: result };
  }

  // DesignerPRO addition — not upstream Postiz code.
  //
  // Upstream has no way for a Public API caller to learn which integration a
  // given connect attempt (`GET /social/:integration` above) resolved to —
  // the OAuth callback lands on Postiz's own frontend, which completes the
  // connection via the session-authenticated `POST /integrations/social-connect/:integration`
  // (no.auth.integrations.controller.ts), not through the Public API at all.
  // That handler stashes `connect-result:${state}` in Redis once it knows the
  // resulting integration id — including when `createOrUpdateIntegration`
  // reuses an existing row for the same real-world account rather than
  // minting a new one (its upsert key is org+internalId, not customer/group),
  // which is exactly the case a naive before/after list diff cannot see.
  //
  // The `organization:${state}` check below both scopes this lookup to the
  // caller's own org and doubles as existence/expiry validation, since it is
  // set (with a 1h TTL) by the same call that minted `state` in the first
  // place.
  @Get('/social/state/:state')
  async getSocialConnectResult(
    @GetOrgFromRequest() org: Organization,
    @Param('state') state: string
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const orgForState = await ioRedis.get(`organization:${state}`);
    if (!orgForState || orgForState !== org.id) {
      throw new HttpException({ msg: 'State not found' }, 404);
    }

    const raw = await ioRedis.get(`connect-result:${state}`);
    if (!raw) {
      return { status: 'pending' as const };
    }

    const result = JSON.parse(raw);
    return {
      status: 'connected' as const,
      integration: {
        id: result.id,
        name: result.name,
        identifier: result.identifier,
        picture: result.picture ?? null,
      },
    };
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginated(
      org.id,
      query.page ?? 0
    );
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/video/function')
  videoFunction(@Body() body: VideoFunctionDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.videoFunction(
      body.identifier,
      body.functionName,
      body.params
    );
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postsService.deletePost(org.id, post.group).catch(() => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!loadIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = socialIntegrationList.find(
      (p) => p.identifier === loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/posts/:id/status')
  async changePostStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ChangePostStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.changePostStatus(org.id, id, body.status);
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Get('/analytics/:integration')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/analytics/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Post('/integration-trigger/:id')
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { methodName: string; data: Record<string, string> }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider = socialIntegrationList.find(
      (p) => p.identifier === getIntegration.providerIdentifier
    )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 404);
    }

    while (true) {
      try {
        // @ts-ignore
        const result = await integrationProvider[body.methodName](
          getIntegration.token,
          body.data || {},
          getIntegration.internalId,
          getIntegration
        );

        return { output: result };
      } catch (err) {
        if (err instanceof RefreshToken) {
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          const { accessToken } = data;

          if (accessToken) {
            getIntegration.token = accessToken;

            if (integrationProvider.refreshWait) {
              await timer(10000);
            }

            continue;
          }
        }
        throw new HttpException({ msg: 'Unexpected error' }, 500);
      }
    }
  }
}
