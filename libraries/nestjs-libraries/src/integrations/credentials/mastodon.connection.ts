// DesignerPRO addition (2026-09-08). Keep OAuth connections unchanged.
import { MastodonProvider } from '../social/mastodon.provider';
import {
  CredentialConnection,
  CredentialError,
  credentialJson,
  required,
  serviceUrl,
  legacyContext,
} from './credential.connection';
export const mastodonConnection: CredentialConnection = {
  async customFields() {
    return [
      { key: 'instanceUrl', label: 'Instance URL', type: 'text' },
      { key: 'accessToken', label: 'Access Token', type: 'password' },
    ];
  },
  async authenticate(fields) {
    const instanceUrl = await serviceUrl(
      required(fields, 'instanceUrl').trim()
    );
    const accessToken = required(fields, 'accessToken', 4096).trim();
    const account = await credentialJson(
      `${instanceUrl}/api/v1/accounts/verify_credentials`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Access Token inválido ou sem permissão para ler a conta nesta instância.'
    );
    if (!account.id || !account.username)
      throw new CredentialError('Não foi possível validar a conta Mastodon.');
    return {
      id: `${instanceUrl}/${account.id}`,
      name: account.display_name || account.username,
      username: account.acct || account.username,
      token: accessToken,
      credentials: { instanceUrl, accountId: String(account.id) },
    };
  },
  async post(provider, auth, posts, _integration, reply) {
    const context = legacyContext(provider);
    const url = await serviceUrl(auth.credentials.instanceUrl);
    return reply
      ? MastodonProvider.prototype.dynamicComment.call(
          context,
          auth.credentials.accountId,
          reply.root,
          reply.last,
          auth.token!,
          url,
          posts
        )
      : MastodonProvider.prototype.dynamicPost.call(
          context,
          auth.credentials.accountId,
          auth.token!,
          url,
          posts
        );
  },
};
