import type { AppContext } from './context.js';

/**
 * Hesabı siler ve izlerini kaldırır: ses kanalından çıkarır, açık bağlantılarını kapatır, profil
 * fotoğrafını siler, diğer istemcilere haber verir. Mesajlar kalır, yazarı "Silinmiş Kullanıcı" olur.
 */
export async function removeAccount(ctx: AppContext, userId: string, reason: string): Promise<boolean> {
  const { store, voice, livekit, gateway, avatars } = ctx;
  const state = voice.get(userId);
  const avatar = store.getAvatarHash(userId);
  if (!store.deleteUser(userId)) return false;
  if (state) {
    await livekit.removeParticipant(state.channelId, userId);
    voice.leave(userId, state.channelId);
  }
  gateway.disconnectUser(userId, reason);
  gateway.broadcast({ t: 'USER_DELETE', d: { id: userId } });
  // Silinemezse de sorun değil: kimsenin kullanmadığı dosyayı temizlik görevi siler
  await avatars.removeDeleted(avatar).catch(() => undefined);
  return true;
}
