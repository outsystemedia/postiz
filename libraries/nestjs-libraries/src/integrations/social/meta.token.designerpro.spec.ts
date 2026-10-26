import {
  decryptMetaProviderToken,
  encryptMetaProviderToken,
} from './meta.token';

describe('Meta provider token storage', () => {
  const previousSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'designerpro-meta-token-test-secret';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it('encrypts Facebook, Instagram and Threads tokens at rest and decrypts them for providers', () => {
    for (const provider of [
      'facebook',
      'instagram',
      'instagram-standalone',
      'threads',
    ]) {
      const encrypted = encryptMetaProviderToken(
        provider,
        'page-token___user-token'
      );
      expect(encrypted).toMatch(/^secret:v1:/);
      expect(encrypted).not.toContain('page-token');
      expect(decryptMetaProviderToken(encrypted)).toBe(
        'page-token___user-token'
      );
    }
  });

  it('leaves unrelated providers and already encrypted values unchanged', () => {
    expect(encryptMetaProviderToken('x', 'plain-token')).toBe('plain-token');
    const encrypted = encryptMetaProviderToken('facebook', 'plain-token');
    expect(encryptMetaProviderToken('facebook', encrypted)).toBe(encrypted);
  });
});
