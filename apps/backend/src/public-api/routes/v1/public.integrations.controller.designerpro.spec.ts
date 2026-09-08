// DesignerPRO addition — not upstream Postiz code.
//
// Targeted unit tests for the DesignerPRO additions to
// PublicIntegrationsController: `state` now comes back from
// `GET /social/:integration`, and the new `GET /social/state/:state` lets a
// Public API caller learn exactly which integration a connect attempt
// resolved to (see the file for why a before/after list diff can't do this).
// It also covers the capability handshake that lets DesignerPRO fail closed
// while an older deployment lacks safe WordPress inline-media publishing.
// Does not attempt to cover this file's pre-existing, untested upstream
// methods.
//
// Uses the real `ioRedis` export rather than mocking it — with no REDIS_URL
// set (the case in this test run), it resolves to the in-memory MockRedis
// fallback (see redis.service.ts), so `.set`/`.get` here exercise the exact
// same code path the controller uses, without a real Redis dependency.
import { HttpException } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

// Same rationale as public.groups.controller.spec.ts, extended to every
// service this (much larger) controller imports: each pulls in real
// modules that transitively depend on ESM-only packages Jest's CJS
// transform can't parse (isomorphic-dompurify via PostsService,
// nostr-tools via IntegrationManager's provider registry, etc). None of
// these services are exercised by the tests below — only hand-built mock
// objects are passed into the controller's constructor — so stubbing their
// modules out keeps the real, unrelated files from ever loading.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: jest.fn() })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: jest.fn() })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({
    MediaService: jest.fn(),
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: jest.fn() })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
  socialIntegrationList: [],
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({
    RefreshIntegrationService: jest.fn(),
  })
);

import { PublicIntegrationsController } from './public.integrations.controller';

const ORG = { id: 'org_1' } as any;
const OTHER_ORG = { id: 'org_2' } as any;

function buildController(integrationManager?: any) {
  const unused = {} as any;
  const controller = new PublicIntegrationsController(
    unused, // _integrationService
    unused, // _postsService
    unused, // _mediaService
    unused, // _notificationService
    integrationManager ?? unused, // _integrationManager
    unused // _refreshIntegrationService
  );
  return { controller };
}

function buildWordpressController(authResult?: any) {
  const provider = {
    oneTimeToken: false,
    authenticate: jest.fn().mockResolvedValue(
      authResult ?? {
        id: 'https://wp.example.com_7',
        name: 'Editor',
        username: 'editor',
        picture: 'https://wp.example.com/avatar.jpg',
        accessToken: 'secret:v1:encrypted',
        refreshToken: '',
        expiresIn: 999999,
      }
    ),
  };
  const integrationManager = {
    getSocialIntegration: jest.fn().mockReturnValue(provider),
  };
  const integrationService = {
    createOrUpdateIntegration: jest.fn().mockResolvedValue({
      id: 'int_wp',
      name: 'Editor',
      providerIdentifier: 'wordpress',
      picture: 'https://wp.example.com/avatar.jpg',
    }),
  };
  const refreshIntegrationService = {
    startRefreshWorkflow: jest.fn().mockResolvedValue(undefined),
  };
  const unused = {} as any;
  const controller = new PublicIntegrationsController(
    integrationService as any,
    unused,
    unused,
    unused,
    integrationManager as any,
    refreshIntegrationService as any
  );
  return {
    controller,
    provider,
    integrationService,
    refreshIntegrationService,
  };
}

describe('PublicIntegrationsController — DesignerPRO connect-state additions', () => {
  afterEach(async () => {
    await ioRedis.del('organization:state_1');
    await ioRedis.del('integration:state_1');
    await ioRedis.del('login:state_1');
    await ioRedis.del('connect-result:state_1');
  });

  describe('GET /capabilities', () => {
    it('advertises WordPress inline-media support', async () => {
      const { controller } = buildController();

      await expect(controller.getPublicationCapabilities(ORG)).resolves.toEqual(
        { wordpressInlineMedia: true }
      );
    });
  });

  describe('GET /social/:integration', () => {
    it('returns the state alongside the auth url', async () => {
      const integrationManager = {
        getAllowedSocialsIntegrations: () => ['x'],
        getSocialIntegration: () => ({
          externalUrl: false,
          generateAuthUrl: async () => ({
            codeVerifier: 'cv',
            state: 'state_1',
            url: 'https://x.example.com/authorize',
          }),
        }),
      };
      const { controller } = buildController(integrationManager);

      const result = await controller.getIntegrationUrl('x', '', ORG);

      expect(result).toEqual({
        url: 'https://x.example.com/authorize',
        state: 'state_1',
      });
      await expect(ioRedis.get('integration:state_1')).resolves.toBe('x');
    });
  });

  describe('POST /social/wordpress/connect', () => {
    async function seedWordpressState(provider = 'wordpress') {
      await ioRedis.set('organization:state_1', ORG.id);
      await ioRedis.set('integration:state_1', provider);
      await ioRedis.set('login:state_1', 'code-verifier');
    }

    it('rejects a state minted for another provider', async () => {
      await seedWordpressState('x');
      const { controller, provider, integrationService } =
        buildWordpressController();

      await expect(
        controller.connectWordpress(ORG, {
          state: 'state_1',
          domain: 'https://wp.example.com',
          username: 'editor',
          password: 'application password',
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(provider.authenticate).not.toHaveBeenCalled();
      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('does not persist anything when WordPress rejects the credentials', async () => {
      await seedWordpressState();
      const { controller, integrationService } = buildWordpressController(
        'Invalid credentials'
      );

      await expect(
        controller.connectWordpress(ORG, {
          state: 'state_1',
          domain: 'https://wp.example.com',
          username: 'editor',
          password: 'wrong',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('rejects an invalid timezone before checking credentials', async () => {
      await seedWordpressState();
      const { controller, provider, integrationService } =
        buildWordpressController();

      await expect(
        controller.connectWordpress(ORG, {
          state: 'state_1',
          domain: 'https://wp.example.com',
          username: 'editor',
          password: 'application password',
          timezone: 'not-a-number',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(provider.authenticate).not.toHaveBeenCalled();
      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('connects with provider-encrypted credentials and exposes no secret', async () => {
      await seedWordpressState();
      const {
        controller,
        provider,
        integrationService,
        refreshIntegrationService,
      } = buildWordpressController();

      const result = await controller.connectWordpress(ORG, {
        state: 'state_1',
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application password',
        timezone: '60',
      });

      const encoded = provider.authenticate.mock.calls[0][0].code;
      expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toEqual({
        domain: 'https://wp.example.com',
        username: 'editor',
        password: 'application password',
      });
      expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledWith(
        undefined,
        false,
        ORG.id,
        'Editor',
        'https://wp.example.com/avatar.jpg',
        'social',
        'https://wp.example.com_7',
        'wordpress',
        'secret:v1:encrypted',
        '',
        999999,
        'editor',
        false,
        undefined,
        60
      );
      expect(refreshIntegrationService.startRefreshWorkflow).toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('application password');
      await expect(ioRedis.get('login:state_1')).resolves.toBeUndefined();
      await expect(ioRedis.get('connect-result:state_1')).resolves.toContain(
        'int_wp'
      );
    });
  });

  describe('GET /social/state/:state', () => {
    it('returns 404 when the state is unknown (never issued or expired)', async () => {
      const { controller } = buildController();

      await expect(
        controller.getSocialConnectResult(ORG, 'state_never_issued')
      ).rejects.toThrow(HttpException);
    });

    it("returns 404 when the state belongs to a different org's connect attempt", async () => {
      await ioRedis.set('organization:state_1', ORG.id);
      const { controller } = buildController();

      await expect(
        controller.getSocialConnectResult(OTHER_ORG, 'state_1')
      ).rejects.toThrow(HttpException);
    });

    it('returns pending when the OAuth handshake has not completed yet', async () => {
      await ioRedis.set('organization:state_1', ORG.id);
      const { controller } = buildController();

      const result = await controller.getSocialConnectResult(ORG, 'state_1');

      expect(result).toEqual({ status: 'pending' });
    });

    it('returns the resolved integration once the connect callback has stashed it', async () => {
      await ioRedis.set('organization:state_1', ORG.id);
      await ioRedis.set(
        'connect-result:state_1',
        JSON.stringify({
          id: 'int_42',
          name: 'my_handle',
          identifier: 'x',
          picture: 'https://pic.example.com/a.png',
        })
      );
      const { controller } = buildController();

      const result = await controller.getSocialConnectResult(ORG, 'state_1');

      expect(result).toEqual({
        status: 'connected',
        integration: {
          id: 'int_42',
          name: 'my_handle',
          identifier: 'x',
          picture: 'https://pic.example.com/a.png',
        },
      });
    });
  });
});

describe('credential connections', () => {
  const credentials = { apiKey: 'do-not-log-this' };
  const identity = { id: 'account-1', name: 'Writer', username: 'writer', token: 'do-not-log-this', credentials: {} };
  function setup() {
    process.env.JWT_SECRET = 'local-unit-test-secret';
    const authenticate = jest.fn().mockResolvedValue(identity);
    const service = { getCustomer: jest.fn().mockResolvedValue({ id: 'brand-1' }), saveCredentialIntegration: jest.fn().mockImplementation(async (...args) => ({ id: args[2], name: args[4], providerIdentifier: args[3] })) };
    const manager = { getSocialIntegration: jest.fn().mockReturnValue({ credentialConnection: { authenticate } }) };
    const unused = {} as any;
    return { authenticate, service, controller: new PublicIntegrationsController(service as any, unused, unused, unused, manager as any, unused) };
  }
  it('checks group ownership before attempting authentication', async () => {
    const { service, authenticate, controller } = setup();
    service.getCustomer.mockResolvedValue(null);
    await expect(controller.connectCredentials(ORG, 'devto', { groupId: 'brand-1', credentials })).rejects.toMatchObject({ status: 404 });
    expect(authenticate).not.toHaveBeenCalled();
    expect(service.saveCredentialIntegration).not.toHaveBeenCalled();
  });
  it('does not persist or leak invalid credential errors', async () => {
    const { service, authenticate, controller } = setup();
    authenticate.mockRejectedValue(new Error('do-not-log-this'));
    await expect(controller.connectCredentials(ORG, 'devto', { groupId: 'brand-1', credentials })).rejects.not.toThrow('do-not-log-this');
    expect(service.saveCredentialIntegration).not.toHaveBeenCalled();
  });
  it('isolates providers and brands while reconnecting the same account idempotently', async () => {
    const { service, controller } = setup();
    const first = await controller.connectCredentials(ORG, 'devto', { groupId: 'brand-1', credentials });
    const again = await controller.connectCredentials(ORG, 'devto', { groupId: 'brand-1', credentials });
    const otherBrand = await controller.connectCredentials(ORG, 'devto', { groupId: 'brand-2', credentials });
    const otherProvider = await controller.connectCredentials(ORG, 'hashnode', { groupId: 'brand-1', credentials });
    expect(first.integration.id).toBe(again.integration.id);
    expect(first.integration.id).not.toBe(otherBrand.integration.id);
    expect(first.integration.id).not.toBe(otherProvider.integration.id);
    expect(service.saveCredentialIntegration.mock.calls[0][6]).toMatch(/^secret:v1:/);
    expect(JSON.stringify(first)).not.toContain('do-not-log-this');
  });
});
