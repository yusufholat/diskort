// Sunucu ve masaüstü istemcisi arasında paylaşılan tipler ve sabitler.

// ---------- Modeller ----------

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
}

export interface Guild {
  id: string;
  name: string;
}

export type ChannelType = 'voice' | 'text';

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: ChannelType;
  position: number;
}

export interface VoiceState {
  userId: string;
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  streaming: boolean;
  joinedAt: number;
}

export interface Invite {
  code: string;
  createdBy: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
}

// ---------- REST ----------

export interface RegisterRequest {
  inviteCode: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface UpdateMeRequest {
  displayName?: string;
  avatarColor?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Yöneticinin verdiği tek kullanımlık kodla şifre sıfırlama (giriş ekranı). */
export interface ResetPasswordRequest {
  username: string;
  code: string;
  newPassword: string;
}

export interface ResetCodeResponse {
  code: string;
  expiresAt: number;
}

export interface UpdateUserRequest {
  isAdmin?: boolean;
}

export interface CreateInviteRequest {
  maxUses?: number | null;
  expiresInHours?: number | null;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
}

export interface UpdateChannelRequest {
  name?: string;
  position?: number;
}

export interface VoiceJoinResponse {
  /** İstemcinin bağlanacağı LiveKit adresi (ws:// veya wss://) */
  url: string;
  token: string;
  roomName: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

// ---------- Gateway (WebSocket) ----------

export interface ReadyPayload {
  user: User;
  guild: Guild;
  channels: Channel[];
  users: User[];
  voiceStates: VoiceState[];
  online: string[];
}

export type GatewayServerMessage =
  | { t: 'HELLO'; d: { heartbeatInterval: number } }
  | { t: 'READY'; d: ReadyPayload }
  | { t: 'HEARTBEAT_ACK' }
  | { t: 'VOICE_STATE_UPDATE'; d: VoiceState }
  | { t: 'VOICE_STATE_DELETE'; d: { userId: string; channelId: string } }
  | { t: 'USER_UPDATE'; d: User }
  | { t: 'USER_DELETE'; d: { id: string } }
  | { t: 'PRESENCE_UPDATE'; d: { userId: string; online: boolean } }
  | { t: 'CHANNEL_CREATE'; d: Channel }
  | { t: 'CHANNEL_UPDATE'; d: Channel }
  | { t: 'CHANNEL_DELETE'; d: { id: string } }
  | { t: 'INVALID_SESSION'; d: { reason: string } };

export type GatewayClientMessage =
  | { t: 'IDENTIFY'; d: { token: string } }
  | { t: 'HEARTBEAT' }
  | { t: 'VOICE_STATE_SET'; d: { selfMute: boolean; selfDeaf: boolean } };

// ---------- Sabitler ----------

export const GATEWAY_HEARTBEAT_INTERVAL_MS = 15_000;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 32;
export const CHANNEL_NAME_MAX_LENGTH = 48;

export const AVATAR_COLORS = [
  '#5865f2',
  '#3ba55c',
  '#faa61a',
  '#ed4245',
  '#eb459e',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#747f8d',
] as const;

const VOICE_ROOM_PREFIX = 'ch_';

export function voiceRoomName(channelId: string): string {
  return VOICE_ROOM_PREFIX + channelId;
}

export function channelIdFromRoom(roomName: string): string | null {
  return roomName.startsWith(VOICE_ROOM_PREFIX) ? roomName.slice(VOICE_ROOM_PREFIX.length) : null;
}
