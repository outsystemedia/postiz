// DesignerPRO addition — not upstream Postiz code.
//
// Targeted unit tests for the DesignerPRO additions to
// PublicIntegrationsController: `state` now comes back from
// `GET /social/:integration`, and the new `GET /social/state/:state` lets a
// Public API caller learn exactly which integration a connect attempt
// resolved to (see the file for why a before/after list diff can't do this).
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
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: jest.fn(),
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: jest.fn() })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
  socialIntegrationList: [],
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: jest.fn(),
}));

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

describe('PublicIntegrationsController — DesignerPRO connect-state additions', () => {
  afterEach(async () => {
    await ioRedis.del('organization:state_1');
    await ioRedis.del('connect-result:state_1');
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
