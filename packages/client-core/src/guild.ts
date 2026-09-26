import { create } from 'zustand';
import type { Channel, GatewayServerMessage, Guild, ReadyPayload, User, VoiceState } from '@diskort/shared';

export type GatewayStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting';

interface GuildStore {
  status: GatewayStatus;
  guild: Guild | null;
  channels: Channel[];
  users: Record<string, User>;
  voiceStates: Record<string, VoiceState>;
  online: Record<string, true>;
  /** Metin kanalı → en son mesaj kimliği */
  lastMessageIds: Record<string, string>;
  /** Metin kanalı → bu kullanıcının okuduğu son mesaj */
  readStates: Record<string, string>;
  markRead: (channelId: string, messageId: string) => void;
  setLastMessageId: (channelId: string, messageId: string | null) => void;
  setStatus: (status: GatewayStatus) => void;
  setReady: (payload: ReadyPayload) => void;
  apply: (msg: GatewayServerMessage) => void;
  reset: () => void;
}

const sortChannels = (channels: Channel[]): Channel[] =>
  [...channels].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'tr'));

const initial = {
  status: 'idle' as GatewayStatus,
  guild: null,
  channels: [],
  users: {},
  voiceStates: {},
  online: {},
  lastMessageIds: {},
  readStates: {},
};

/** Gateway'den gelen topluluk durumu: kanallar, kullanıcılar, kim hangi ses kanalında. */
export const useGuild = create<GuildStore>()((set) => ({
  ...initial,
  setStatus: (status) => set({ status }),
  setReady: (p) =>
    set({
      status: 'ready',
      guild: p.guild,
      channels: sortChannels(p.channels),
      users: Object.fromEntries(p.users.map((u) => [u.id, u])),
      voiceStates: Object.fromEntries(p.voiceStates.map((v) => [v.userId, v])),
      online: Object.fromEntries(p.online.map((id) => [id, true as const])),
      lastMessageIds: p.lastMessageIds,
      readStates: p.readStates,
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
        case 'CHANNEL_DELETE':
          return { channels: s.channels.filter((c) => c.id !== msg.d.id) };
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
