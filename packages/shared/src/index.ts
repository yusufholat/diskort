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

export interface Message {
  /** Kanal içinde artan sayısal kimlik (metin olarak) */
  id: string;
  channelId: string;
  /** Yazarın hesabı silindiyse null */
  authorId: string | null;
  content: string;
  createdAt: number;
  editedAt: number | null;
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

export interface PushTokenRequest {
  token: string;
  platform: 'android' | 'ios';
}

export interface DeleteAccountRequest {
  password: string;
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

export interface CreateMessageRequest {
  content: string;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface AckRequest {
  messageId: string;
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
  /** Metin kanallarındaki en son mesaj kimliği (kanal → mesaj) */
  lastMessageIds: Record<string, string>;
  /** Bu kullanıcının kanal başına okuduğu son mesaj (kanal → mesaj) */
  readStates: Record<string, string>;
  /** Bu kullanıcının kanal başına okunmamış bahsetme sayısı */
  mentionCounts: Record<string, number>;
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
  | { t: 'MESSAGE_CREATE'; d: Message }
  | { t: 'MESSAGE_UPDATE'; d: Message }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channelId: string } }
  | { t: 'TYPING_START'; d: { channelId: string; userId: string } }
  | { t: 'INVALID_SESSION'; d: { reason: string } }
  /** İstemci sürümü eski: bağlantı kapatılır, güncellemeden yeniden bağlanılamaz */
  | { t: 'UPDATE_REQUIRED'; d: { version: string } }
  /** Yeni sürüm yayınlandı: istemci arka planda indirmeye başlar */
  | { t: 'UPDATE_AVAILABLE'; d: { version: string } };

/** İstemci türü: sürüm kuralı her platform için ayrı uygulanır */
export type ClientPlatform = 'desktop' | 'android' | 'ios';

export interface IdentifyPayload {
  token: string;
  /** Uygulama sürümü (masaüstünde 0.1.3'ten itibaren gönderilir) */
  version?: string;
  /** Bildirilmezse masaüstü sayılır (0.1.4 öncesi masaüstü sürümleri göndermez) */
  platform?: ClientPlatform;
}

export type GatewayClientMessage =
  | { t: 'IDENTIFY'; d: IdentifyPayload }
  | { t: 'HEARTBEAT' }
  | { t: 'VOICE_STATE_SET'; d: { selfMute: boolean; selfDeaf: boolean } }
  | { t: 'TYPING_START'; d: { channelId: string } };

// ---------- Sabitler ----------

export const GATEWAY_HEARTBEAT_INTERVAL_MS = 15_000;
/** Gateway kapanış kodu: istemci güncellenmeden yeniden bağlanmamalı */
export const GATEWAY_CLOSE_UPDATE_REQUIRED = 4010;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 32;
export const CHANNEL_NAME_MAX_LENGTH = 48;
export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_PAGE_SIZE = 50;
/** "Yazıyor…" göstergesinin geçerlilik süresi; istemci bu aralıkta en fazla bir kez bildirir */
export const TYPING_TIMEOUT_MS = 8000;

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

// ---------- Yardımcılar ----------

/**
 * Metindeki @kullanıcıadı bahsetmeleri (küçük harfle, tekrarsız). E-posta gibi bir kelimenin
 * ortasındaki @ sayılmaz; sondaki noktalar ("@ali.") cümle noktalaması kabul edilir.
 */
export function extractMentions(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/(?<![a-z0-9_.@])@([a-z0-9_.]*[a-z0-9_])/gi)) names.add(m[1]!.toLowerCase());
  return [...names];
}

/** "1.2.3" biçimindeki sürümleri karşılaştırır (ön ek "v" ve "-beta" gibi ekler yok sayılır). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split(/[-+]/)[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
