import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  withCredentialConnection,
  readCredentialEnvelope,
  CredentialError,
} from './credential.connection';

beforeAll(() => {
  process.env.JWT_SECRET = 'local-test-secret-not-a-production-key';
});
const identity = {
  version: 1,
  provider: 'bluesky',
  id: 'did:test',
  name: 'Test',
  username: 'test',
  credentials: { password: 'never-log-this-password' },
};
it('encrypts credentials with randomized authenticated encryption', () => {
  const a = AuthService.encryptSecret(JSON.stringify(identity));
  const b = AuthService.encryptSecret(JSON.stringify(identity));
  expect(a).not.toBe(b);
  expect(a).not.toContain(identity.credentials.password);
  expect(readCredentialEnvelope(a, 'bluesky')).toEqual(identity);
  expect(() => readCredentialEnvelope(a, 'telegram')).toThrow();
  expect(() =>
    readCredentialEnvelope(a.slice(0, -8) + 'tampered', 'bluesky')
  ).toThrow();
});
it('preserves legacy publishing and only dispatches encrypted connections to the adapter', async () => {
  const legacy = jest.fn().mockResolvedValue(['legacy']);
  const adapter = {
    post: jest.fn().mockResolvedValue([{ postId: 'published' }]),
    authenticate: jest.fn(),
    customFields: jest.fn(),
  };
  const provider = withCredentialConnection(
    { identifier: 'bluesky', post: legacy } as any,
    adapter
  );
  expect(await provider.post('old', 'legacy-token', [], {})).toEqual([
    'legacy',
  ]);
  expect(adapter.post).not.toHaveBeenCalled();
  expect(
    await provider.post(
      'scoped',
      AuthService.encryptSecret(JSON.stringify(identity)),
      [],
      {}
    )
  ).toEqual([{ postId: 'published' }]);
  expect(legacy).toHaveBeenCalledTimes(1);
});
it('does not forward secrets from SDK errors into Temporal failure details', async () => {
  const provider = withCredentialConnection(
    { identifier: 'bluesky', post: jest.fn() } as any,
    {
      post: async () => {
        throw new Error('Authorization: never-log-this-password');
      },
      authenticate: jest.fn(),
      customFields: jest.fn(),
    }
  );
  try {
    await provider.post(
      'scoped',
      AuthService.encryptSecret(JSON.stringify(identity)),
      [],
      {}
    );
    throw new Error('Expected failure');
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain('never-log-this-password');
  }
});
