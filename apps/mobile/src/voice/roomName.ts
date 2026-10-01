import { channelById, dmTitle, useGuild, useSession, type GuildStore } from '@diskort/client-core';

// Bağlı olunan ses odasının adı: sunucunun ses kanalı ya da direkt mesaj araması (konuşmanın adı; bire
// bir konuşmada karşı taraf). DM'de sunucu bilgisi gösterilmez.

type NameState = Parameters<typeof channelById>[0] & Pick<GuildStore, 'dms' | 'users'>;

/** Odanın adı; bilinmiyorsa (ör. henüz yüklenmedi) "Ses kanalı" */
export function voiceRoomName(s: NameState, channelId: string | null | undefined, selfId: string | undefined): string {
  if (!channelId) return 'Ses kanalı';
  const dm = s.dms[channelId];
  if (dm) return dmTitle(dm, s.users, selfId);
  return channelById(s, channelId)?.name ?? 'Ses kanalı';
}

/** Oda bir direkt mesaj araması mı */
export function useIsDmCall(channelId: string | null | undefined): boolean {
  return useGuild((s) => Boolean(channelId && s.dms[channelId]));
}

/** Odanın adı (değişince yeniden çizer) */
export function useVoiceRoomName(channelId: string | null | undefined): string {
  const selfId = useSession((s) => s.user?.id);
  return useGuild((s) => voiceRoomName(s, channelId, selfId));
}
