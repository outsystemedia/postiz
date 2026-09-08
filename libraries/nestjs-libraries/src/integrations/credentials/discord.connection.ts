// DesignerPRO addition (2026-09-08). User-owned incoming webhook or bot.
import { DiscordProvider } from '../social/discord.provider';
import { CredentialConnection, CredentialError, credentialJson, required, legacyContext, credentialFetch } from './credential.connection';
export function discordPermissions(roles: any[], member: any, overwrites: any[], guildId: string, userId: string): bigint {
  const memberRoles = new Set([guildId, ...member.roles]);
  let permissions = roles.filter(role => memberRoles.has(role.id)).reduce((all, role) => all | BigInt(role.permissions), BigInt(0));
  if (permissions & BigInt(8)) return permissions | BigInt(3072);
  const apply = (items: any[]) => { let deny = BigInt(0), allow = BigInt(0); for (const item of items) { deny |= BigInt(item.deny); allow |= BigInt(item.allow); } permissions = (permissions & ~deny) | allow; };
  apply(overwrites.filter(item => item.id === guildId));
  apply(overwrites.filter(item => item.type === 0 && item.id !== guildId && memberRoles.has(item.id)));
  apply(overwrites.filter(item => item.type === 1 && item.id === userId));
  return permissions;
}
export const discordConnection: CredentialConnection = {
  async customFields() { return [{ key: 'webhookUrl', label: 'Webhook URL', type: 'password', required: false }, { key: 'botToken', label: 'Bot Token', type: 'password', required: false }, { key: 'channelId', label: 'Channel ID', type: 'text', required: false }]; },
  async authenticate(fields) {
    if (fields.webhookUrl?.trim()) {
      if (fields.botToken?.trim() || fields.channelId?.trim()) throw new CredentialError('Escolha Webhook URL OU Bot Token + Channel ID.');
      let url: URL;
      try { url = new URL(required(fields, 'webhookUrl').trim()); } catch { throw new CredentialError('Webhook URL inválida.'); }
      if (url.origin !== 'https://discord.com' || url.search || url.hash || !/^\/api(?:\/v10)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new CredentialError('Use uma Webhook URL HTTPS do domínio discord.com.');
      const hook = await credentialJson(url.href, {}, 'Webhook inválido ou revogado.');
      if (!hook.id || !hook.channel_id || hook.type !== 1) throw new CredentialError('O webhook não permite publicar neste canal.');
      return { id: hook.channel_id, name: hook.name || 'Discord', username: hook.name || '', credentials: { webhookUrl: url.href, channelId: hook.channel_id, guildId: hook.guild_id || '@me' } };
    }
    const botToken = required(fields, 'botToken', 512).trim();
    const channelId = required(fields, 'channelId', 30).trim();
    if (!/^\d+$/.test(channelId)) throw new CredentialError('Channel ID inválido.');
    const headers = { Authorization: `Bot ${botToken}` };
    const me = await credentialJson('https://discord.com/api/v10/users/@me', { headers }, 'Bot Token Discord inválido.');
    if (!me.id || !me.bot) throw new CredentialError('Informe o token de um bot Discord.');
    const channel = await credentialJson(`https://discord.com/api/v10/channels/${channelId}`, { headers }, 'Canal não encontrado ou bot sem acesso.');
    if (![0, 5].includes(channel.type) || !channel.guild_id) throw new CredentialError('Escolha um canal de texto ou anúncios do servidor.');
    const [roles, member] = await Promise.all([
      credentialJson(`https://discord.com/api/v10/guilds/${channel.guild_id}/roles`, { headers }),
      credentialJson(`https://discord.com/api/v10/guilds/${channel.guild_id}/members/${me.id}`, { headers })
    ]);
    const permissions = discordPermissions(roles, member, channel.permission_overwrites || [], channel.guild_id, me.id);
    if ((permissions & BigInt(3072)) !== BigInt(3072)) throw new CredentialError('O bot precisa das permissões Ver canal e Enviar mensagens.');
    return { id: channelId, name: channel.name || me.username, username: me.username, credentials: { botToken, channelId, guildId: channel.guild_id } };
  },
  async post(provider, auth, posts, _integration, reply) {
    const context = legacyContext(provider);
    const credentials = auth.credentials;
    context.fetch = async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (credentials.webhookUrl) headers.delete('Authorization');
      else headers.set('Authorization', `Bot ${credentials.botToken}`);
      const response = await credentialFetch(credentials.webhookUrl ? `${credentials.webhookUrl}?wait=true` : `https://discord.com/api/v10/channels/${credentials.channelId}/messages`, { ...init, headers });
      if (!response.ok) throw new CredentialError('O Discord recusou a publicação. Verifique o token/webhook, permissões e conteúdo.');
      return response;
    };
    // Both modes send follow-up messages to the fixed destination. No thread
    // creation or global bot credentials are needed for this connection mode.
    const result = await DiscordProvider.prototype.post.call(context, credentials.guildId, '', posts.map(post => ({ ...post, settings: { ...post.settings, channel: credentials.channelId } })));
    if (!result[0]?.postId) throw new CredentialError('O Discord não confirmou a publicação.');
    return result;
  }
};
