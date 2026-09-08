// DesignerPRO addition (2026-09-08). A bot client per credential connection.
import TelegramBot from 'node-telegram-bot-api';
import { TelegramProvider } from '../social/telegram.provider';
import {
  CredentialConnection,
  CredentialError,
  required,
  legacyContext,
} from './credential.connection';
function bot(token: string) {
  return new TelegramBot(token, {
    polling: false,
    request: { timeout: 30000 } as any,
  });
}
export const telegramConnection: CredentialConnection = {
  async customFields() {
    return [
      { key: 'botToken', label: 'Bot Token', type: 'password' },
      { key: 'chatId', label: 'Chat / Channel ID', type: 'text' },
    ];
  },
  async authenticate(fields) {
    const botToken = required(fields, 'botToken', 200).trim();
    const chatId = required(fields, 'chatId', 100).trim();
    if (!/^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(botToken))
      throw new CredentialError(
        'Bot Token inválido. Copie o token gerado pelo @BotFather.'
      );
    if (!/^(?:-?[0-9]+|@[A-Za-z0-9_]+)$/.test(chatId))
      throw new CredentialError('Chat/Channel ID inválido.');
    const client = bot(botToken);
    let me: TelegramBot.User;
    try {
      me = await client.getMe();
    } catch {
      throw new CredentialError('Bot Token inválido ou Telegram indisponível.');
    }
    if (!me.id || !me.is_bot)
      throw new CredentialError('O token não identifica um bot Telegram.');
    let chat: TelegramBot.Chat;
    try {
      chat = await client.getChat(chatId);
    } catch {
      throw new CredentialError(
        'Chat não encontrado. Confira o ID e adicione o bot ao destino.'
      );
    }
    if (chat.type !== 'private') {
      const member = await client
        .getChatMember(chat.id, me.id)
        .catch(() => undefined);
      if (
        !member ||
        ['left', 'kicked'].includes(member.status) ||
        (chat.type === 'channel' &&
          (member.status !== 'administrator' ||
            !(member as any).can_post_messages))
      ) {
        throw new CredentialError(
          'Adicione o bot ao canal como administrador com permissão para publicar.'
        );
      }
      if (member.status === 'restricted' && !(member as any).can_send_messages)
        throw new CredentialError(
          'O bot não tem permissão para enviar mensagens neste grupo.'
        );
    }
    return {
      id: String(chat.id),
      name: chat.title || chat.username || String(chat.id),
      username: chat.username || '',
      credentials: {
        botToken,
        chatId: String(chat.id),
        username: chat.username || '',
      },
    };
  },
  async post(provider, auth, posts, _integration, reply) {
    const context = legacyContext(provider);
    context.bot = bot(auth.credentials.botToken);
    const [post] = posts;
    const messageId = await context.sendMessage(
      auth.credentials.chatId,
      post,
      reply ? Number(reply.last || reply.root) : undefined
    );
    if (!messageId)
      throw new CredentialError('O Telegram não confirmou a publicação.');
    const destination =
      auth.credentials.username ||
      `c/${auth.credentials.chatId.replace(/^-100/, '')}`;
    return [
      {
        id: post.id,
        postId: String(messageId),
        releaseURL: `https://t.me/${destination}/${messageId}`,
        status: 'completed',
      },
    ];
  },
};
