jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ uploadSimple: async (picture: string) => picture }),
  },
}));

import { IntegrationService } from './integration.service';

type ProviderMap = Record<string, Record<string, jest.Mock>>;

function buildService(primary: any, providers: ProviderMap) {
  const repository = {
    getIntegrationById: jest.fn().mockResolvedValue(primary),
    checkForDeletedOnceAndUpdate: jest.fn().mockResolvedValue(undefined),
    updateIntegration: jest.fn().mockImplementation(async (_id, data) => ({
      id: `int_${data.providerIdentifier ?? primary.providerIdentifier}`,
      providerIdentifier: primary.providerIdentifier,
      ...data,
    })),
    createOrUpdateIntegration: jest
      .fn()
      .mockImplementation(async (...args) => ({
        id: `int_${args[7]}`,
        name: args[3],
        picture: args[4],
        providerIdentifier: args[7],
        internalId: args[6],
        profile: args[11],
      })),
  };
  const manager = {
    getSocialIntegration: jest.fn(
      (identifier: string) => providers[identifier]
    ),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any,
    manager as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, repository, manager };
}

describe('IntegrationService — linked Meta assets', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'designerpro-meta-pair-test-secret';
  });

  it('requires a Facebook Page selection before completing the connection', async () => {
    const facebook = { fetchPageInformation: jest.fn() };
    const { service } = buildService(
      {
        id: 'int_login',
        providerIdentifier: 'facebook',
        inBetweenSteps: true,
        token: 'user-token',
        refreshToken: 'user-token',
        internalId: 'meta-user',
      },
      { facebook }
    );

    await expect(
      service.saveProviderPage('org_1', 'int_login', {})
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(facebook.fetchPageInformation).not.toHaveBeenCalled();
  });

  it('selecting Facebook also creates the Instagram profile linked to that Page', async () => {
    const facebook = {
      fetchPageInformation: jest.fn().mockResolvedValue({
        id: 'page_123',
        name: 'Acme Page',
        picture: 'https://pic.example.com/fb.png',
        access_token: 'page-token',
        username: 'acme.page',
      }),
    };
    const instagram = {
      pages: jest
        .fn()
        .mockResolvedValue([
          { id: 'ig_123', pageId: 'page_123', name: 'Acme' },
        ]),
      fetchPageInformation: jest.fn().mockResolvedValue({
        id: 'ig_123',
        name: 'Acme',
        picture: 'https://pic.example.com/ig.png',
        access_token: 'ig-page-token___user-token',
        username: 'acme',
      }),
    };
    const { service, repository } = buildService(
      {
        id: 'int_login',
        providerIdentifier: 'facebook',
        inBetweenSteps: true,
        token: 'user-token',
        refreshToken: 'user-token',
        internalId: 'meta-user',
        rootInternalId: 'meta-user',
        tokenExpiration: new Date(Date.now() + 60_000),
      },
      { facebook, instagram }
    );

    const result = await service.saveProviderPage('org_1', 'int_login', {
      page: 'page_123',
    });

    expect(facebook.fetchPageInformation).toHaveBeenCalledWith('user-token', {
      page: 'page_123',
    });
    expect(instagram.pages).toHaveBeenCalledWith('user-token');
    expect(instagram.fetchPageInformation).toHaveBeenCalledWith('user-token', {
      id: 'ig_123',
      pageId: 'page_123',
    });
    expect(repository.createOrUpdateIntegration).toHaveBeenCalledWith(
      undefined,
      false,
      'org_1',
      'Acme',
      'https://pic.example.com/ig.png',
      'social',
      'ig_123',
      'instagram',
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      'acme',
      false,
      undefined,
      undefined,
      undefined,
      'meta-user'
    );
    expect(result.metaPageId).toBe('page_123');
    expect(result.integrations.map((item) => item.providerIdentifier)).toEqual([
      'facebook',
      'instagram',
    ]);
  });

  it('selecting Instagram also creates its Facebook Page', async () => {
    const instagram = {
      fetchPageInformation: jest.fn().mockResolvedValue({
        id: 'ig_123',
        name: 'Acme',
        picture: 'https://pic.example.com/ig.png',
        access_token: 'ig-page-token___user-token',
        username: 'acme',
      }),
    };
    const facebook = {
      fetchPageInformation: jest.fn().mockResolvedValue({
        id: 'page_123',
        name: 'Acme Page',
        picture: 'https://pic.example.com/fb.png',
        access_token: 'page-token',
        username: 'acme.page',
      }),
    };
    const { service } = buildService(
      {
        id: 'int_login',
        providerIdentifier: 'instagram',
        inBetweenSteps: true,
        token: 'user-token',
        refreshToken: 'user-token',
        internalId: 'meta-user',
        rootInternalId: 'meta-user',
      },
      { facebook, instagram }
    );

    const result = await service.saveProviderPage('org_1', 'int_login', {
      id: 'ig_123',
      pageId: 'page_123',
    });

    expect(facebook.fetchPageInformation).toHaveBeenCalledWith('user-token', {
      page: 'page_123',
    });
    expect(result.metaPageId).toBe('page_123');
    expect(result.integrations.map((item) => item.providerIdentifier)).toEqual([
      'instagram',
      'facebook',
    ]);
  });
});
