const login = jest.fn();
const getProfile = jest.fn();
jest.mock('@atproto/api', () => ({
  BskyAgent: jest
    .fn()
    .mockImplementation(() => ({
      login,
      getProfile,
      session: { did: 'did:plc:test' },
    })),
}));
jest.mock('../social/bluesky.provider', () => ({ BlueskyProvider: class {} }));
jest.mock('../../dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: async () => true,
}));
import { blueskyConnection } from './bluesky.connection';
beforeEach(() => {
  login.mockReset().mockResolvedValue({});
  getProfile
    .mockReset()
    .mockResolvedValue({ data: { handle: 'test.bsky.social' } });
});
it('authenticates a real session and rejects a malformed app password before login', async () => {
  await expect(
    blueskyConnection.authenticate({
      identifier: 'test',
      password: 'main-password',
    })
  ).rejects.toThrow('App password');
  expect(login).not.toHaveBeenCalled();
  const auth = await blueskyConnection.authenticate({
    identifier: 'test',
    password: 'aaaa-bbbb-cccc-dddd',
  });
  expect(auth.id).toBe('did:plc:test');
  expect(login).toHaveBeenCalledWith({
    identifier: 'test',
    password: 'aaaa-bbbb-cccc-dddd',
  });
});
it('sanitizes rejected login errors', async () => {
  login.mockRejectedValue(new Error('secret sdk request'));
  await expect(
    blueskyConnection.authenticate({
      identifier: 'test',
      password: 'aaaa-bbbb-cccc-dddd',
    })
  ).rejects.toThrow('App password inválida');
});
