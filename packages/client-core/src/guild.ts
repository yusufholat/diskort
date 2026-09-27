import { create } from 'zustand';
import {
  DEFAULT_ATTACHMENT_MAX_BYTES,
  type Channel,
  type DmChannel,
  type GatewayServerMessage,
  type Guild,
  type ReadyPayload,
  type Role,
  type User,
  type VoiceState,
} from '@diskort/shared';

export type GatewayStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting';

export interface GuildStore {
  status: GatewayStatus;
  guild: Guild | null;
  /** Yalnızca kullanıcının görebildiği kanallar (sunucu süzer); direkt mesajlar burada değil */
  channels: Channel[];
  /** Listede açık direkt mesaj konuşmaları (kimlik → konuşma); DM'leri tanımayan sunucuda boş */
  dms: Record<string, DmChannel>;
  /** Atılan/yasaklananlar dahil (mesajlarda adları görünsün diye); üye listesinde `removed` olanlar gösterilmez */
  users: Record<string, User>;
  /** @everyone dahil tüm roller (@everyone'ın kimliği topluluk kimliğidir) */
  roles: Record<string, Role>;
  voiceStates: Record<string, VoiceState>;
  online: Record<string, true>;
  /** Metin kanalı ya da DM → en son mesaj kimliği */
  lastMessageIds: Record<string, string>;
  /** Metin kanalı ya da DM → bu kullanıcının okuduğu son mesaj */
  readStates: Record<string, string>;
  /** Sunucunun kabul ettiği en büyük dosya (bayt) */
  attachmentMaxBytes: number;
  markRead: (channelId: string, messageId: string) => void;
  setLastMessageId: (channelId: string, messageId: string | null) => void;
  /** REST yanıtıyla gelen konuşmayı hemen listeye koyar (gateway olayı da gelir; tekrar zararsız) */
  upsertDm: (dm: DmChannel) => void;
  removeDm: (id: string) => void;
  setStatus: (status: GatewayStatus) => void;
  setReady: (payload: ReadyPayload) => void;
  apply: (msg: GatewayServerMessage) => void;
  reset: () => void;
}

const sortChannels = (channels: Channel[]): Channel[] =>
  [...channels].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'tr'));

const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

const initial = {
  status: 'idle' as GatewayStatus,
  guild: null,
  channels: [],
  dms: {},
  users: {},
  roles: {},
  voiceStates: {},
  online: {},
  lastMessageIds: {},
  readStates: {},
  attachmentMaxBytes: DEFAULT_ATTACHMENT_MAX_BYTES,
};

/** Gateway'den gelen topluluk durumu: kanallar, kullanıcılar, roller, kim hangi ses kanalında. */
export const useGuild = create<GuildStore>()((set) => ({
  ...initial,
  setStatus: (status) => set({ status }),
  setReady: (p) =>
    set({
      status: 'ready',
      guild: p.guild,
      channels: sortChannels(p.channels),
      dms: byId(p.dms ?? []),
      users: byId(p.users),
      roles: byId(p.roles ?? []),
      voiceStates: Object.fromEntries(p.voiceStates.map((v) => [v.userId, v])),
      online: Object.fromEntries(p.online.map((id) => [id, true as const])),
      lastMessageIds: p.lastMessageIds,
      readStates: p.readStates,
      attachmentMaxBytes: p.attachmentMaxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES,
    }),
  markRead: (channelId, messageId) =>
    set((s) =>
      Number(messageId) > Number(s.readStates[channelId] ?? 0)
        ? { readStates: { ...s.readStates, [channelId]: messageId } }
        : {},
    ),
  setLastMessageId: (channelId, messageId) =>
    set((s) => {
      const lastMessageIds = { ...s.lastMessageIds };
      if (messageId) lastMessageIds[channelId] = messageId;
      else delete lastMessageIds[channelId];
      return { lastMessageIds };
    }),
  upsertDm: (dm) => set((s) => ({ dms: { ...s.dms, [dm.id]: dm } })),
  removeDm: (id) =>
    set((s) => {
      if (!s.dms[id]) return {};
      const { [id]: _removed, ...dms } = s.dms;
      return { dms };
    }),
  apply: (msg) =>
    set((s) => {
      switch (msg.t) {
        case 'VOICE_STATE_UPDATE':
          return { voiceStates: { ...s.voiceStates, [msg.d.userId]: msg.d } };
        case 'VOICE_STATE_DELETE': {
          if (s.voiceStates[msg.d.userId]?.channelId !== msg.d.channelId) return {};
          const { [msg.d.userId]: _removed, ...rest } = s.voiceStates;
          return { voiceStates: rest };
        }
        case 'USER_UPDATE':
          return { users: { ...s.users, [msg.d.id]: msg.d } };
        case 'USER_DELETE': {
          const { [msg.d.id]: _user, ...users } = s.users;
          const { [msg.d.id]: _voice, ...voiceStates } = s.voiceStates;
          const { [msg.d.id]: _online, ...online } = s.online;
          // Silinen hesap konuşmalardan düşer (sunucu da güncel konuşmayı gönderir)
          const dms = Object.values(s.dms).some((d) => d.participantIds.includes(msg.d.id))
            ? Object.fromEntries(
                Object.entries(s.dms).map(([id, d]) => [
                  id,
                  d.participantIds.includes(msg.d.id)
                    ? { ...d, participantIds: d.participantIds.filter((p) => p !== msg.d.id) }
                    : d,
                ]),
              )
            : s.dms;
          return { users, voiceStates, online, dms };
        }
        case 'PRESENCE_UPDATE': {
          const online = { ...s.online };
          if (msg.d.online) online[msg.d.userId] = true;
          else delete online[msg.d.userId];
          return { online };
        }
        case 'CHANNEL_CREATE':
        case 'CHANNEL_UPDATE':
          return { channels: sortChannels([...s.channels.filter((c) => c.id !== msg.d.id), msg.d]) };
        case 'CHANNEL_DELETE': {
          // Kanal silindi ya da artık görülemiyor: oradaki ses durumları da gider
          const voiceStates = Object.fromEntries(
            Object.entries(s.voiceStates).filter(([, v]) => v.channelId !== msg.d.id),
          );
          return { channels: s.channels.filter((c) => c.id !== msg.d.id), voiceStates };
        }
        case 'GUILD_UPDATE':
          return { guild: msg.d };
        case 'ROLES_UPDATE':
          return { roles: byId(msg.d.roles) };
        case 'MESSAGE_CREATE': {
          if (Number(msg.d.id) <= Number(s.lastMessageIds[msg.d.channelId] ?? 0)) return {};
          const lastMessageIds = { ...s.lastMessageIds, [msg.d.channelId]: msg.d.id };
          const dm = s.dms[msg.d.channelId];
          // DM listesi son etkinliğe göre sıralanır
          return dm
            ? {
                lastMessageIds,
                dms: { ...s.dms, [dm.id]: { ...dm, lastMessageId: msg.d.id, lastActivityAt: msg.d.createdAt } },
              }
            : { lastMessageIds };
        }
        case 'DM_CHANNEL_CREATE':
        case 'DM_CHANNEL_UPDATE': {
          // Konuşma listeye (yeniden) girerken son mesajı okunmamış bilgisine de yansır
          const last = msg.d.lastMessageId;
          const lastMessageIds =
            last && Number(last) > Number(s.lastMessageIds[msg.d.id] ?? 0)
              ? { ...s.lastMessageIds, [msg.d.id]: last }
              : s.lastMessageIds;
          return { dms: { ...s.dms, [msg.d.id]: msg.d }, lastMessageIds };
        }
        case 'DM_CHANNEL_DELETE': {
          if (!s.dms[msg.d.id]) return {};
          const { [msg.d.id]: _removed, ...dms } = s.dms;
          return { dms };
        }
        default:
          return {};
      }
    }),
  reset: () => set(initial),
}));

/** Kanalda okunmamış mesaj var mı */
export function isUnread(state: Pick<GuildStore, 'lastMessageIds' | 'readStates'>, channelId: string): boolean {
  const last = state.lastMessageIds[channelId];
  return last !== undefined && Number(last) > Number(state.readStates[channelId] ?? 0);
}

export function membersOf(voiceStates: Record<string, VoiceState>, channelId: string): VoiceState[] {
  return Object.values(voiceStates)
    .filter((v) => v.channelId === channelId)
    .sort((a, b) => a.joinedAt - b.joinedAt);
}
