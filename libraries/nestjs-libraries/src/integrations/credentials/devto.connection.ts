// DesignerPRO addition (2026-09-08).
import { DevToProvider } from '../social/dev.to.provider';
import { CredentialConnection, CredentialError, credentialJson, required, legacyContext } from './credential.connection';
export const devtoConnection: CredentialConnection = {
  async customFields() { return [{ key: 'apiKey', label: 'API Key', type: 'password' }]; },
  async authenticate(fields) {
    const apiKey = required(fields, 'apiKey', 4096).trim();
    const me = await credentialJson('https://dev.to/api/users/me', { headers: { 'api-key': apiKey } }, 'API Key Dev.to inválida. Gere uma chave em Settings → Extensions.');
    if (!me.id || !me.username) throw new CredentialError('A API Key não retornou uma conta Dev.to válida.');
    return { id: String(me.id), name: me.name || me.username, username: me.username, token: apiKey, credentials: {} };
  },
  async post(provider, auth, posts, integration, reply) {
    if (reply) throw new CredentialError('Dev.to não suporta respostas automáticas nesta conexão.');
    return DevToProvider.prototype.post.call(legacyContext(provider), auth.id, auth.token!, posts, integration);
  }
};
