jest.mock('../social/dev.to.provider', () => ({ DevToProvider: class {} }));
jest.mock('../social/mastodon.provider', () => ({
  MastodonProvider: class {},
}));
jest.mock('../social/discord.provider', () => ({ DiscordProvider: class {} }));
jest.mock('../../dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: async (url: string) => !url.includes('127.0.0.1'),
}));
import { devtoConnection } from './devto.connection';
import { mastodonConnection } from './mastodon.connection';
import { lemmyConnection } from './lemmy.connection';
import { discordConnection, discordPermissions } from './discord.connection';
import { hashnodeConnection } from './hashnode.connection';
import { redactCredentialTelemetry } from './credential.redaction';
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
function response(body: any, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}
it('rejects a Dev.to 401 even when its JSON body is valid', async () => {
  fetchMock.mockResolvedValue(response({ error: 'unauthorized' }, 401));
  await expect(
    devtoConnection.authenticate({ apiKey: 'secret' })
  ).rejects.toThrow('API Key');
});
it('accepts a verified Dev.to user and sends only the API-key header', async () => {
  fetchMock.mockResolvedValue(response({ id: 9, username: 'writer' }));
  expect((await devtoConnection.authenticate({ apiKey: 'secret' })).id).toBe(
    '9'
  );
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'api-key': 'secret' });
});
it('binds Mastodon identities to their instance and checks the token', async () => {
  fetchMock.mockResolvedValue(response({ id: '9', username: 'writer' }));
  const result = await mastodonConnection.authenticate({
    instanceUrl: 'https://mastodon.social',
    accessToken: 'secret',
  });
  expect(result.id).toBe('https://mastodon.social/9');
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://mastodon.social/api/v1/accounts/verify_credentials'
  );
  await expect(
    mastodonConnection.authenticate({
      instanceUrl: 'http://127.0.0.1',
      accessToken: 'secret',
    })
  ).rejects.toThrow();
});
it('rejects invalid Mastodon tokens', async () => {
  fetchMock.mockResolvedValue(response({}, 401));
  await expect(
    mastodonConnection.authenticate({
      instanceUrl: 'https://mastodon.social',
      accessToken: 'secret',
    })
  ).rejects.toThrow('Access Token');
});
it('rejects a Lemmy login without a JWT and never persists an unauthenticated user', async () => {
  fetchMock.mockResolvedValue(response({ error: 'incorrect_login' }));
  await expect(
    lemmyConnection.authenticate({
      service: 'https://lemmy.world',
      identifier: 'writer',
      password: 'secret',
    })
  ).rejects.toThrow('Login Lemmy');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('resolves the authenticated Lemmy user when using an email login', async () => {
  fetchMock
    .mockResolvedValueOnce(response({ jwt: 'session' }))
    .mockResolvedValueOnce(
      response({
        my_user: { local_user_view: { person: { id: 3, name: 'writer' } } },
      })
    );
  const result = await lemmyConnection.authenticate({
    service: 'https://lemmy.world',
    identifier: 'writer@example.com',
    password: 'secret',
  });
  expect(result.id).toBe('https://lemmy.world/3');
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
    'Bearer session'
  );
});
it('validates Discord webhook host, existence and mode before accepting it', async () => {
  await expect(
    discordConnection.authenticate({
      webhookUrl: 'https://evil.example/api/webhooks/1/secret',
    })
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(
    response({ id: '1', type: 1, channel_id: '2', name: 'Hook' })
  );
  expect(
    (
      await discordConnection.authenticate({
        webhookUrl: 'https://discord.com/api/webhooks/1/secret',
      })
    ).id
  ).toBe('2');
  fetchMock.mockResolvedValue(response({}, 404));
  await expect(
    discordConnection.authenticate({
      webhookUrl: 'https://discord.com/api/webhooks/1/secret',
    })
  ).rejects.toThrow('Webhook');
});
it('honors Discord channel permission denials and member overrides', () => {
  const roles = [{ id: 'guild', permissions: '3072' }];
  const member = { roles: [] };
  const denied = [{ id: 'guild', type: 0, allow: '0', deny: '2048' }];
  expect(
    discordPermissions(roles, member, denied, 'guild', 'bot') & BigInt(2048)
  ).toBe(BigInt(0));
  expect(
    discordPermissions(
      roles,
      member,
      [...denied, { id: 'bot', type: 1, allow: '2048', deny: '0' }],
      'guild',
      'bot'
    ) & BigInt(2048)
  ).toBe(BigInt(2048));
});
it('validates Hashnode ownership and rejects invalid GraphQL tokens / paid-plan errors', async () => {
  const fields = {
    personalAccessToken: 'secret',
    publicationId: 'a'.repeat(24),
  };
  fetchMock.mockResolvedValueOnce(
    response({
      data: {
        me: { id: '1', username: 'writer' },
        publication: {
          id: fields.publicationId,
          title: 'Blog',
          author: { id: '1' },
        },
      },
    })
  );
  expect((await hashnodeConnection.authenticate(fields)).id).toBe(
    fields.publicationId
  );
  fetchMock.mockResolvedValueOnce(
    response({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] })
  );
  await expect(hashnodeConnection.authenticate(fields)).rejects.toThrow(
    'Personal Access Token'
  );
  fetchMock.mockResolvedValueOnce(
    response({
      errors: [{ message: 'Publication does not have an active Pro plan' }],
    })
  );
  await expect(hashnodeConnection.authenticate(fields)).rejects.toThrow(
    'não oferece conexão gratuita'
  );
});
it('redacts credentials from telemetry including bot/webhook URLs', () => {
  const value = redactCredentialTelemetry({
    request: {
      data: JSON.stringify({ credentials: { password: 'topsecret' } }),
      headers: { Authorization: 'topsecret' },
    },
    breadcrumbs: [
      { data: { url: 'https://api.telegram.org/bot123:topsecret/getMe' } },
      { message: 'https://discord.com/api/webhooks/123/topsecret' },
    ],
  });
  expect(JSON.stringify(value)).not.toContain('topsecret');
});
