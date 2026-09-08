const getMe = jest.fn(),
  getChat = jest.fn(),
  getChatMember = jest.fn();
jest.mock('node-telegram-bot-api', () =>
  jest.fn().mockImplementation(() => ({ getMe, getChat, getChatMember }))
);
jest.mock('../social/telegram.provider', () => ({
  TelegramProvider: class {},
}));
import { telegramConnection } from './telegram.connection';
const fields = {
  botToken: '12345:abcdefghijklmnopqrstuvwxy',
  chatId: '-100111',
};
beforeEach(() => {
  getMe.mockReset().mockResolvedValue({ id: 12345, is_bot: true });
  getChat
    .mockReset()
    .mockResolvedValue({ id: -100111, type: 'channel', title: 'Test' });
  getChatMember
    .mockReset()
    .mockResolvedValue({ status: 'administrator', can_post_messages: true });
});
it('validates bot identity and destination publishing permission', async () => {
  expect((await telegramConnection.authenticate(fields)).id).toBe('-100111');
  expect(getMe).toHaveBeenCalledTimes(1);
  expect(getChatMember).toHaveBeenCalledWith(-100111, 12345);
});
it('rejects an invalid token without echoing SDK request details', async () => {
  getMe.mockRejectedValue(new Error(fields.botToken));
  await expect(telegramConnection.authenticate(fields)).rejects.toThrow(
    'Bot Token inválido'
  );
});
it('requires publishing permission, not only administrator status', async () => {
  getChatMember.mockResolvedValue({
    status: 'administrator',
    can_post_messages: false,
  });
  await expect(telegramConnection.authenticate(fields)).rejects.toThrow(
    'permissão para publicar'
  );
});
