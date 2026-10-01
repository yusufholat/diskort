import { useShallow } from 'zustand/react/shallow';
import { DM_CALL_RING_MS, hasPermission, Permission, type DmCall, type UserBlock, type VoiceState } from '@diskort/shared';
import { api, errorMessage } from './api';
import { env } from './env';
import { membersOf, useGuild, type GuildStore } from './guild';
import { permissionsOf } from './permissions';
import { useSession } from './session';

// Direkt mesaj aramaları ve engellemeler. Arama, konuşmanın ses odasına bağlanınca başlar: istemci her
// zamanki ses bağlantısını konuşmanın kimliğiyle kurar (api.joinVoice(dmId) → LiveKit). Sunucu ilk
// bağlananın katılımıyla diğer katılımcıları çalar (DM_CALL_UPDATE.ringing), oda boşalınca arama biter
// (DM_CALL_DELETE). Kimin aramada olduğu voiceStates'tedir (channelId = konuşmanın kimliği). Buradakiler
// platformdan bağımsız seçiciler ve işlemler; zil sesi, açılır pencere ve bağlanma platformun işidir.

type CallState = Pick<GuildStore, 'dmCalls'>;

/** Konuşmada süren arama (yoksa undefined) */
export function dmCallOf(s: CallState, channelId: string | null | undefined): DmCall | undefined {
  return channelId ? s.dmCalls[channelId] : undefined;
}

/** Bu aramada sen çalınıyor musun */
export const isRingingMe = (call: Pick<DmCall, 'ringing'> | undefined, selfId: string | undefined): boolean =>
  Boolean(call && selfId && call.ringing.includes(selfId));

/**
 * Seni çalan aramalar (gelen arama penceresi), en yeni başlayan önce. Zaten aramada olduğun konuşma
 * dahil değildir (sunucu da çalmaz). Aynı anda birden çok olabilir (ör. iki ayrı konuşmadan). Bağlantı
 * hazır değilken (koptu, yeniden bağlanıyor) boştur: sunucunun çalmayı bitirdiğini o sırada bilemeyiz. Çalma
 * istemcide de en çok DM_CALL_RING_MS + DM_CALL_RING_GRACE_MS sürer (bkz. aşağıdaki yerel süre).
 */
export function incomingCalls(
  s: Pick<GuildStore, 'dmCalls' | 'voiceStates' | 'status'>,
  selfId: string | undefined,
): DmCall[] {
  if (!selfId || s.status !== 'ready') return [];
  const here = s.voiceStates[selfId]?.channelId;
  return Object.values(s.dmCalls)
    .filter((c) => c.ringing.includes(selfId) && c.channelId !== here)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Çalmanın istemcideki en uzun süresine (DM_CALL_RING_MS) eklenen pay: sunucunun bitiş olayı önce gelsin */
export const DM_CALL_RING_GRACE_MS = 5_000;

/**
 * Yerel çalma süresi: bağlantı koparsa sunucunun "çalma bitti" olayı gelmeyebilir. Seni çalan bir arama ilk
 * görüldüğünde (ya da sunucu yeniden çalınca: ringStartedAt değişince) süre başlar; dolunca çalma bu cihazda
 * susturulur (stopRingingLocally: depo değişir, arayüz yeniden çizilir). Aramanın kendisi depoda kalır
 * (arayan tarafın görünümü ona bakar). Masaüstü ve telefon bunu ayrıca kurmaz.
 */
const localRings = new Map<string, { stamp: number | undefined; timer: ReturnType<typeof setTimeout> }>();
/** Yerelde süresi dolan çalmaların damgası: aynı çalma sonraki bir olayla yeniden başlamasın */
const expiredRings = new Map<string, number | undefined>();

function syncLocalRings(s: Pick<GuildStore, 'dmCalls'>): void {
  const selfId = useSession.getState().user?.id;
  for (const [channelId, entry] of localRings) {
    const call = s.dmCalls[channelId];
    if (call && selfId && call.ringing.includes(selfId)) continue;
    clearTimeout(entry.timer);
    localRings.delete(channelId);
  }
  for (const channelId of expiredRings.keys()) if (!s.dmCalls[channelId]) expiredRings.delete(channelId);
  if (!selfId) return;
  for (const call of Object.values(s.dmCalls)) {
    if (!call.ringing.includes(selfId)) continue;
    const stamp = call.ringStartedAt?.[selfId];
    const entry = localRings.get(call.channelId);
    if (entry && entry.stamp === stamp) continue;
    if (!entry && expiredRings.has(call.channelId) && expiredRings.get(call.channelId) === stamp) {
      // Süresi dolmuş aynı çalma: yeniden çaldırmadan sustur
      useGuild.getState().stopRingingLocally(call.channelId, selfId);
      continue;
    }
    if (entry) clearTimeout(entry.timer);
    expiredRings.delete(call.channelId);
    const channelId = call.channelId;
    const timer = setTimeout(() => {
      if (localRings.get(channelId)?.timer !== timer) return;
      localRings.delete(channelId);
      expiredRings.set(channelId, stamp);
      useGuild.getState().stopRingingLocally(channelId, selfId);
    }, DM_CALL_RING_MS + DM_CALL_RING_GRACE_MS);
    localRings.set(channelId, { stamp, timer });
  }
}

useGuild.subscribe((next, prev) => {
  if (next.dmCalls !== prev.dmCalls) syncLocalRings(next);
});

/** Aramadakiler (konuşmanın ses odasındakiler), katılma sırasıyla */
export const callMembers = (s: Pick<GuildStore, 'voiceStates'>, channelId: string): VoiceState[] =>
  membersOf(s.voiceStates, channelId);

/**
 * Bu konuşmada arama yapılabilir / aramaya katılınabilir mi (CONNECT). Salt okunur konuşmada (ortak sunucu
 * kalmadı, engel) hayır. DM'yi tanımayan eski sunucu ses odasını reddeder; o zaman da arama düğmesi
 * işe yaramaz (sunucu sürümü DM aramasını bilmeli).
 */
export function canCallDm(s: Parameters<typeof permissionsOf>[0], selfId: string | undefined, channelId: string): boolean {
  return hasPermission(permissionsOf(s, selfId, channelId), Permission.CONNECT);
}

/** Konuşmadaki arama (değişince yeniden çizer) */
export function useDmCall(channelId: string | null | undefined): DmCall | undefined {
  return useGuild((s) => dmCallOf(s, channelId));
}

/** Seni çalan aramalar (gelen arama penceresi ve zil sesi için) */
export function useIncomingCalls(): DmCall[] {
  const selfId = useSession((s) => s.user?.id);
  return useGuild(useShallow((s) => incomingCalls(s, selfId)));
}

/** Konuşmanın aramasındakiler */
export function useCallMembers(channelId: string): VoiceState[] {
  return useGuild(useShallow((s) => callMembers(s, channelId)));
}

/** Bu konuşmada arama yapılabilir mi */
export function useCanCallDm(channelId: string): boolean {
  const selfId = useSession((s) => s.user?.id);
  return useGuild((s) => canCallDm(s, selfId, channelId));
}

/**
 * Çalan aramayı reddeder: bu cihazda hemen, sunucu da diğer cihazlarında susturur. Arama sürer (sen
 * yine katılabilirsin); karşı taraf seni çalınanlar listesinde artık görmez.
 */
export async function declineDmCall(channelId: string): Promise<void> {
  const selfId = useSession.getState().user?.id;
  if (selfId) useGuild.getState().stopRingingLocally(channelId, selfId);
  try {
    await api.declineDmCall(channelId);
  } catch (err) {
    env().notifyError(errorMessage(err));
  }
}

/** Aramadayken katılmayan birini (userId yoksa herkesi) yeniden çalar */
export async function ringDmCall(channelId: string, userId?: string): Promise<boolean> {
  try {
    await api.ringDmCall(channelId, userId);
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}

// ---------- Engellemeler ----------

/** Bu kişiyi engelledin mi (yalnızca kendi listen; seni engelleyen bilinmez) */
export const isBlocked = (s: Pick<GuildStore, 'blockedIds'>, userId: string | null | undefined): boolean =>
  Boolean(userId && s.blockedIds[userId]);

export function useIsBlocked(userId: string | null | undefined): boolean {
  return useGuild((s) => isBlocked(s, userId));
}

/** Engellediklerinin kimlikleri (değişmedikçe aynı dizi) */
export function useBlockedIds(): string[] {
  return useGuild(useShallow((s) => Object.keys(s.blockedIds)));
}

/** Engellediklerin, profilleriyle (ayarlardaki liste) */
export async function loadBlocks(): Promise<UserBlock[] | null> {
  try {
    return await api.listBlocks();
  } catch (err) {
    env().notifyError(errorMessage(err));
    return null;
  }
}

/**
 * Kişiyi engeller: bire bir konuşmanız iki taraf için salt okunur olur (geçmiş kalır), yeni konuşma açılamaz,
 * sürmekte olan bire bir aramanız biter; gruplarda onun başlattığı arama seni çalmaz. Sunucu kanallarında
 * hiçbir şey değişmez. Karşı tarafa engellendiği söylenmez.
 */
export async function blockUser(userId: string): Promise<boolean> {
  try {
    await api.blockUser(userId);
    useGuild.getState().setBlocked(userId, true);
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}

export async function unblockUser(userId: string): Promise<boolean> {
  try {
    await api.unblockUser(userId);
    useGuild.getState().setBlocked(userId, false);
    return true;
  } catch (err) {
    env().notifyError(errorMessage(err));
    return false;
  }
}
