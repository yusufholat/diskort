import { create } from 'zustand';
import {
  DEFAULT_ATTACHMENT_MAX_BYTES,
  type Channel,
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
  /** Yalnızca kullanıcının görebildiği kanallar (sunucu süzer) */
  channels: Channel[];
  /** Atılan/yasaklananlar dahil (mesajlarda adları görünsün diye); üye listesinde `removed` olanlar gösterilmez */
  users: Record<string, User>;
  /** @everyone dahil tüm roller (@everyone'ın kimliği topluluk kimliğidir) */
  roles: Record<string, Role>;
  voiceStates: Record<string, VoiceState>;
  online: Record<string, true>;
  /** Metin kanalı → en son mesaj kimliği */
  lastMessageIds: Record<string, string>;
  /** Metin kanalı → bu kullanıcının okuduğu son mesaj */
  readStates: Record<string, string>;
  /** Sunucunun kabul ettiği en büyük dosya (bayt) */
  attachmentMaxBytes: number;
  markRead: (channelId: string, messageId: string) => void;
  setLastMessageId: (channelId: string, messageId: string | null) => void;
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
          return { users, voiceStates, online };
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
        case 'MESSAGE_CREATE':
          return Number(msg.d.id) > Number(s.lastMessageIds[msg.d.channelId] ?? 0)
            ? { lastMessageIds: { ...s.lastMessageIds, [msg.d.channelId]: msg.d.id } }
            : {};
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
