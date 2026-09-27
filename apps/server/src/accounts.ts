import type { AppContext } from './context.js';

/**
 * Hesabı siler ve izlerini kaldırır: ses kanalından çıkarır, açık bağlantılarını kapatır, profil
 * fotoğrafını siler, diğer istemcilere haber verir. Mesajlar kalır, yazarı "Silinmiş Kullanıcı" olur.
 * Direkt mesaj konuşmalarından düşer: kalan katılımcılar güncel hâlini alır, kimsenin kalmadığı konuşma
 * (mesajları ve dosyalarıyla) silinir.
 */
export async function removeAccount(ctx: AppContext, userId: string, reason: string): Promise<boolean> {
  const { store, moderation, gateway, avatars, attachments } = ctx;
  if (!store.getUser(userId)) return false;
  const avatar = store.getAvatarHash(userId);
  const dmIds = store.dmIdsOf(userId);
  await moderation.disconnect(userId);
  store.deleteUser(userId);
  const files = store.cleanupDms(dmIds);
  gateway.disconnectUser(userId, reason);
  gateway.broadcast({ t: 'USER_DELETE', d: { id: userId } });
  for (const id of dmIds) {
    const dm = store.getDm(id);
    if (dm) gateway.sendDm(dm.participantIds, { t: 'DM_CHANNEL_UPDATE', d: dm });
  }
  await attachments.remove(files).catch(() => undefined);
  // Silinemezse de sorun değil: kimsenin kullanmadığı dosyayı temizlik görevi siler
  await avatars.removeDeleted(avatar).catch(() => undefined);
  return true;
}
