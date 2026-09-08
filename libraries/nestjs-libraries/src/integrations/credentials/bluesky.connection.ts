// DesignerPRO addition (2026-09-08). Reuses Bluesky media/thread publishing.
import { BskyAgent } from '@atproto/api';
import { BlueskyProvider } from '../social/bluesky.provider';
import { CredentialConnection, CredentialError, credentialFetch, required, serviceUrl, legacyContext } from './credential.connection';

async function agentFor(fields: Record<string, string>) {
  const service = await serviceUrl(fields.service);
  const agent = new BskyAgent({ service, fetch: credentialFetch });
  try { await agent.login({ identifier: fields.identifier, password: fields.password }); }
  catch { throw new CredentialError('App password inválida ou identificador incorreto. Não use a senha principal.'); }
  return agent;
}
export const blueskyConnection: CredentialConnection = {
  async customFields() { return [
    { key: 'service', label: 'Service URL', type: 'text', defaultValue: 'https://bsky.social' },
    { key: 'identifier', label: 'Handle / Identifier', type: 'text' },
    { key: 'password', label: 'App Password', type: 'password' },
  ]; },
  async authenticate(fields) {
    const credentials = { service: await serviceUrl(fields.service || 'https://bsky.social'), identifier: required(fields, 'identifier', 253).trim(), password: required(fields, 'password', 19) };
    if (!/^[a-zA-Z0-9]{4}(?:-[a-zA-Z0-9]{4}){3}$/.test(credentials.password)) throw new CredentialError('App password inválida. Use o formato xxxx-xxxx-xxxx-xxxx; não use a senha principal.');
    const agent = await agentFor(credentials);
    const { data } = await agent.getProfile({ actor: agent.session!.did });
    return { id: agent.session!.did, name: data.displayName || data.handle, username: data.handle, credentials };
  },
  async post(provider, auth, posts, integration, reply) {
    const context = legacyContext(provider);
    context.getAgent = () => agentFor(auth.credentials);
    return reply
      ? BlueskyProvider.prototype.comment.call(context, auth.id, reply.root, reply.last, '', posts, integration)
      : BlueskyProvider.prototype.post.call(context, auth.id, '', posts, integration);
  },
};
