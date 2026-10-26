import { AuthService } from '@gitroom/helpers/auth/auth.service';

const META_PROVIDERS = new Set([
  'facebook',
  'instagram',
  'instagram-standalone',
  'threads',
]);
const ENCRYPTED_SECRET_PREFIX = 'secret:v1:';

export function encryptMetaProviderToken(provider: string, token: string) {
  if (
    !token ||
    !META_PROVIDERS.has(provider) ||
    token.startsWith(ENCRYPTED_SECRET_PREFIX)
  ) {
    return token;
  }
  return AuthService.encryptSecret(token);
}

export function decryptMetaProviderToken(token: string) {
  return token?.startsWith(ENCRYPTED_SECRET_PREFIX)
    ? AuthService.decryptSecret(token)
    : token;
}
