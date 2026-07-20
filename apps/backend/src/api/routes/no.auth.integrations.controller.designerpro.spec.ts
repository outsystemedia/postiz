// DesignerPRO addition — not upstream Postiz code.
//
// Targeted unit test for the one DesignerPRO addition to this controller:
// once a connect attempt resolves to an integration, the result is stashed
// in Redis under `connect-result:${state}` so a Public API caller can look
// it up via `GET /public/v1/social/state/:state`
// (public.integrations.controller.ts) instead of diffing `GET /integrations`
// snapshots. Does not attempt to cover this file's pre-existing, untested
// upstream connect flow beyond what's needed to reach that point.
//
// Uses the real `ioRedis` export (resolves to the in-memory MockRedis
// fallback with no REDIS_URL set, see redis.service.ts) so this exercises
// the same read/write path the controller and public.integrations.controller.ts
// both use.
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// This controller imports IntegrationManager directly (not just via
// IntegrationService), and IntegrationManager's own module pulls in the full
// social provider registry — including nostr.provider.ts, which depends on
// the ESM-only `nostr-tools` package. None of these are exercised below
// (hand-built mock objects are passed into the controller's constructor
// instead), so stub their modules out to keep the real files from loading.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: jest.fn() })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
  socialIntegrationList: [],
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: jest.fn(),
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: jest.fn() })
);

import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

function buildController(overrides?: {
  createOrUpdateIntegration?: jest.Mock;
  getOrgById?: jest.Mock;
}) {
  const integrationProvider = {
    customFields: false,
    externalUrl: false,
    oneTimeToken: false,
    isBetweenSteps: false,
    isChromeExtension: false,
    authenticate: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 3600,
      refreshToken: 'refresh-token',
      id: 'acct_1',
      name: 'My Handle',
      picture: 'https://pic.example.com/a.png',
      username: 'myhandle',
      additionalSettings: [],
    }),
  };

  const integrationManager = {
    getAllowedSocialsIntegrations: () => ['x'],
    getSocialIntegration: () => integrationProvider,
  } as any;

  const integrationService = {
    createOrUpdateIntegration:
      overrides?.createOrUpdateIntegration ??
      jest.fn().mockResolvedValue({
        id: 'int_new_1',
        name: 'My Handle',
        providerIdentifier: 'x',
        picture: 'https://pic.example.com/a.png',
        token: 'secret-token-must-not-leak',
        refreshToken: 'secret-refresh-must-not-leak',
        customInstanceDetails: null,
      }),
  } as any;

  const refreshIntegrationService = {
    startRefreshWorkflow: jest.fn().mockResolvedValue(undefined),
  } as any;

  const organizationService = {
    getOrgById:
      overrides?.getOrgById ??
      jest.fn().mockResolvedValue({ id: 'org_1', isTrailing: false }),
  } as any;

  const controller = new NoAuthIntegrationsController(
    integrationManager,
    integrationService,
    refreshIntegrationService,
    organizationService
  );

  return { controller, integrationService, integrationProvider };
}

describe('NoAuthIntegrationsController — DesignerPRO connect-result stash', () => {
  const STATE = 'state_1';

  beforeEach(async () => {
    await ioRedis.set(`login:${STATE}`, 'code-verifier');
    await ioRedis.set(`organization:${STATE}`, 'org_1');
  });

  afterEach(async () => {
    await ioRedis.del(`login:${STATE}`);
    await ioRedis.del(`organization:${STATE}`);
    await ioRedis.del(`connect-result:${STATE}`);
  });

  it('stashes the resulting integration id/name/identifier/picture under connect-result:<state>', async () => {
    const { controller } = buildController();

    await controller.connectSocialMedia('x', {
      state: STATE,
      code: 'auth-code',
      timezone: '0',
    } as any);

    const raw = await ioRedis.get(`connect-result:${STATE}`);
    expect(JSON.parse(raw as string)).toEqual({
      id: 'int_new_1',
      name: 'My Handle',
      identifier: 'x',
      picture: 'https://pic.example.com/a.png',
    });
  });

  it('never leaks the token/refreshToken it strips from the response into the stashed result', async () => {
    const { controller } = buildController();

    await controller.connectSocialMedia('x', {
      state: STATE,
      code: 'auth-code',
      timezone: '0',
    } as any);

    const raw = await ioRedis.get(`connect-result:${STATE}`);
    expect(raw).not.toContain('secret-token-must-not-leak');
    expect(raw).not.toContain('secret-refresh-must-not-leak');
  });
});
