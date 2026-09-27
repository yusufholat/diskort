import type { AppContext } from './context.js';

/**
 * Hesabı siler ve izlerini kaldırır: ses kanalından çıkarır, açık bağlantılarını kapatır, diğer
 * istemcilere haber verir. Mesajlar kalır, yazarı "Silinmiş Kullanıcı" olur.
 */
export async function removeAccount(ctx: AppContext, userId: string, reason: string): Promise<boolean> {
  const { store, moderation, gateway } = ctx;
  if (!store.getUser(userId)) return false;
  await moderation.disconnect(userId);
  store.deleteUser(userId);
  gateway.disconnectUser(userId, reason);
  gateway.broadcast({ t: 'USER_DELETE', d: { id: userId } });
  return true;
}
