// DesignerPRO addition — isolated credential connections (2026-09-08).
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { BadBody, SocialAbstract } from '../social.abstract';
import { PostDetails, PostResponse, SocialProvider } from '../social/social.integrations.interface';
import { Integration } from '@prisma/client';
import { isSafePublicHttpsUrl } from '../../dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '../../dtos/webhooks/ssrf.safe.dispatcher';

export class CredentialError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export type CredentialFields = Record<string, string>;
export type CredentialIdentity = {
  id: string; name: string; username: string;
  credentials: CredentialFields; token?: string;
};
export type CredentialEnvelope = CredentialIdentity & { version: 1; provider: string };
export type ExistingProvider = SocialAbstract & SocialProvider;
export type CredentialConnection = {
  customFields(): Promise<Array<{ key: string; label: string; type: 'text' | 'password'; required?: boolean; defaultValue?: string }>>;
  authenticate(fields: CredentialFields): Promise<CredentialIdentity>;
  post(provider: ExistingProvider, auth: CredentialEnvelope, posts: PostDetails[], integration: Integration, reply?: { root: string; last?: string }): Promise<PostResponse[]>;
};
export function required(fields: CredentialFields, key: string, max = 2048): string {
  const value = fields[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new CredentialError('Preencha os campos de conexão corretamente.');
  return value;
}
export async function serviceUrl(value: string): Promise<string> {
  let url: URL;
  try { url = new URL(value); } catch { throw new CredentialError('Informe uma URL HTTPS válida para a instância.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(await isSafePublicHttpsUrl(url.href))) {
    throw new CredentialError('Informe uma instância HTTPS pública, sem caminho, usuário ou senha na URL.');
  }
  return url.origin;
}
// Neither request URLs nor SDK errors are allowed to escape this boundary.
export async function credentialFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.username || url.password || !(await isSafePublicHttpsUrl(url.href))) throw new CredentialError('O endereço do serviço não é permitido.');
  try {
    return await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000), dispatcher: ssrfSafeDispatcher } as RequestInit);
  } catch { throw new CredentialError('Não foi possível acessar o serviço. Verifique o endereço e tente novamente.', 502); }
}
export async function credentialJson(url: string, init: RequestInit = {}, invalid = 'Token inválido ou sem permissão.'): Promise<any> {
  const response = await credentialFetch(url, init);
  if (!response.ok) {
    if (response.status === 429) throw new CredentialError('Limite de requisições atingido. Aguarde e tente novamente.', 429);
    throw new CredentialError(response.status >= 500 ? 'O serviço está temporariamente indisponível.' : invalid, response.status >= 500 ? 502 : 400);
  }
  try { return await response.json(); } catch { throw new CredentialError('O serviço retornou uma resposta inválida.', 502); }
}
export function readCredentialEnvelope(token: string, provider: string): CredentialEnvelope {
  const value = JSON.parse(AuthService.decryptSecret(token));
  if (value.version !== 1 || value.provider !== provider || !value.id || !value.credentials) throw new CredentialError('Reconecte este canal para atualizar suas credenciais.');
  return value;
}
export function withCredentialConnection<T extends ExistingProvider>(provider: T, connection: CredentialConnection): T & { credentialConnection: CredentialConnection } {
  const legacyPost = provider.post.bind(provider);
  const legacyComment = provider.comment?.bind(provider);
  const wrapped = Object.assign(provider, { credentialConnection: connection });
  wrapped.post = async (id, token, posts, integration) => {
    if (!token.startsWith('secret:v1:')) return legacyPost(id, token, posts, integration);
    try { return await connection.post(provider, readCredentialEnvelope(token, provider.identifier), posts, integration); }
    catch (err) { throw new BadBody(provider.identifier, '{}', '{}', err instanceof CredentialError ? err.message : 'Não foi possível publicar. Verifique as credenciais e permissões do canal.'); }
  };
  wrapped.comment = async (id, root, last, token, posts, integration) => {
    if (!token.startsWith('secret:v1:')) return legacyComment ? legacyComment(id, root, last, token, posts, integration) : [];
    try { return await connection.post(provider, readCredentialEnvelope(token, provider.identifier), posts, integration, { root, last }); }
    catch (err) { throw new BadBody(provider.identifier, '{}', '{}', err instanceof CredentialError ? err.message : 'Não foi possível publicar a resposta. Verifique o canal.'); }
  };
  return wrapped;
}
// Call an inherited implementation with its real external identity. Only this
// in-memory context contains plaintext. The database and Temporal retain GCM.
export function legacyContext(provider: ExistingProvider) {
  const context = Object.create(provider);
  context.fetch = async (url: string, init?: RequestInit) => {
    const response = await credentialFetch(url, init);
    if (!response.ok) throw new CredentialError('Não foi possível publicar. Verifique as permissões e o conteúdo.');
    return response;
  };
  return context;
}
