// Sunucu ve masaüstü istemcisi arasında paylaşılan tipler ve sabitler.

import type { PermissionOverwrite, Role } from './permissions';

export * from './permissions';

// ---------- Modeller ----------

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /**
   * Profil fotoğrafı: sunucu köküne göre adres (/api/avatars/<kullanıcı>/<özet>.webp; 256×256 WebP).
   * Kimlik doğrulaması istemez ve içerik değişince adres de değişir (süresiz önbelleklenebilir).
   * Fotoğraf yoksa null; bu alanı bilmeyen eski sunucularda hiç gelmez. Yoksa baş harfler gösterilir.
   */
  avatarUrl?: string | null;
  /** Sahip ya da ADMINISTRATOR yetkili bir rolü var (rollerden önceki istemciler bununla çalışır) */
  isAdmin: boolean;
  /** Rollerinin kimlikleri (@everyone hariç) */
  roles: string[];
  /** Artık üye değil (atıldı ya da yasaklandı); mesajlarında adı görünsün diye listede kalır */
  removed: boolean;
}

export interface Guild {
  id: string;
  name: string;
  /** Sahip: herkesin üstündedir, her yetkiye sahiptir */
  ownerId: string | null;
}

export type ChannelType = 'voice' | 'text';

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: ChannelType;
  position: number;
  /** Rol başına kanal izinleri (özel, salt okunur kanallar için) */
  overwrites: PermissionOverwrite[];
}

/**
 * Direkt mesaj konuşması: bire bir ya da küçük bir grup. Mesajları, dosyaları, tepkileri ve okunma
 * durumu metin kanallarınınkiyle aynıdır (mesajın `channelId`'si konuşmanın kimliğidir), ama topluluğun
 * kanal listesinde yer almaz; yalnızca katılımcılar görür (rol, kanal izni ve yöneticilik uygulanmaz).
 */
export interface DmChannel {
  id: string;
  /** Katılımcılar (sen dahil), katılma sırasıyla. Hesabı silinen katılımcı listeden düşer. */
  participantIds: string[];
  /** Grup konuşması mı. Bire bir konuşma aynı iki kişi için tektir ve ona katılımcı eklenemez. */
  group: boolean;
  /** Grubun adı; verilmemişse (ve bire bir konuşmada) null: katılımcıların adları gösterilir */
  name: string | null;
  /** Grubu kuran (ayrılırsa sıradaki katılımcıya geçer); bire bir konuşmada null */
  ownerId: string | null;
  createdAt: number;
  /** Son mesajın kimliği; mesaj yoksa null */
  lastMessageId: string | null;
  /** Son mesajın zamanı, mesaj yoksa oluşturulma zamanı (liste buna göre sıralanır) */
  lastActivityAt: number;
}

export interface VoiceState {
  userId: string;
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Yetkili biri tarafından sunucuda susturuldu (kendisi açamaz) */
  serverMute: boolean;
  /** Yetkili biri tarafından sunucuda sağırlaştırıldı */
  serverDeaf: boolean;
  streaming: boolean;
  joinedAt: number;
}

/** Mesaja eklenmiş dosya */
export interface Attachment {
  /** 128 bit rastgele kimlik (32 onaltılık karakter); adresin tahmin edilemeyen kısmı */
  id: string;
  /** Temizlenmiş dosya adı */
  name: string;
  /** Bayt */
  size: number;
  /** Resimlerde sunucunun dosya içeriğinden belirlediği tür; diğerlerinde yükleyenin bildirdiği */
  contentType: string;
  /** Yalnızca resimlerde (okunabildiyse), EXIF yönü uygulanmış hâliyle */
  width: number | null;
  height: number | null;
  /**
   * Sunucu köküne göre adres: /api/attachments/<id>/<ad>. Kimlik doğrulaması istemez (resimler
   * <img> ile yüklenebilsin diye); adresi bilen herkes dosyayı alabilir, Discord'daki gibi.
   */
  url: string;
}

/** Bir mesajdaki tek bir emoji tepkisinin özeti */
export interface Reaction {
  /** Tek bir Unicode emoji (özel emoji yok) */
  emoji: string;
  count: number;
  /** İsteği yapan kullanıcı bu tepkiyi vermiş mi */
  me: boolean;
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
  /** Dosya ekleri, eklendiği sırayla (mesajda dosya varsa metin boş olabilir) */
  attachments: Attachment[];
  /** Tepkiler, ilk verilme sırasına göre */
  reactions: Reaction[];
  /** Yazarın yetkisi olan bir @everyone bahsetmesi: kanalı gören herkese bildirim gider */
  mentionEveryone: boolean;
  /**
   * Yanıt verilen mesajın kimliği (Discord'daki "message_reference"); yanıt değilse null. Asıl mesaj
   * silinse de kalır. Yanıtları bilmeyen eski sunucularda hiç gelmez.
   */
  replyToId?: string | null;
  /**
   * Yanıt verilen mesajın kısa özeti; asıl mesaj silindiyse (ya da yanıt değilse) null. Sunucu bunu
   * saklamaz, her okumada asıl mesajdan yeniden üretir; bu yüzden asıl mesaj düzenlenince ya da
   * silinince yeniden yüklenen yanıtlar hep günceldir. Ekrandaki yanıtları istemci, asıl mesajın
   * MESSAGE_UPDATE / MESSAGE_DELETE olaylarıyla kendisi günceller (ayrı bir olay gönderilmez).
   */
  referencedMessage?: ReferencedMessage | null;
  /**
   * Yanıtta asıl mesajın yazarı bildirildiyse ("@ AÇIK") onun kimliği: o kişi için bahsetme sayılır
   * (bildirim gider, mesaj vurgulanır). Asıl mesaj sonradan silinse de kalır.
   */
  replyMentionUserId?: string | null;
}

/** Yanıtın üstünde gösterilen, yanıt verilen mesajın özeti */
export interface ReferencedMessage {
  id: string;
  /** Yazarın hesabı silindiyse null */
  authorId: string | null;
  /** Metnin ilk REPLY_EXCERPT_LENGTH karakteri */
  content: string;
  /** Dosya eki var mı (metni boş, yalnızca dosyalı mesajlarda "Ek" gösterilir) */
  hasAttachments: boolean;
}

/** Gateway'deki mesaj güncellemesi: tepkiler kişiye özel (`me`) olduğundan taşınmaz */
export type MessageUpdate = Omit<Message, 'reactions'>;

/** Bir kullanıcı bir mesaja tepki verdi ya da tepkisini geri aldı */
export interface ReactionEvent {
  messageId: string;
  channelId: string;
  userId: string;
  emoji: string;
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

/** Rollerden önceki istemciler için: yönetici rolü verilir/alınır */
export interface UpdateUserRequest {
  isAdmin?: boolean;
}

export interface CreateRoleRequest {
  name: string;
  color?: string | null;
  hoist?: boolean;
  permissions?: number;
}

export interface UpdateRoleRequest {
  name?: string;
  color?: string | null;
  hoist?: boolean;
  permissions?: number;
}

/** @everyone hariç tüm roller, yukarıdan aşağı yeni sırasıyla */
export interface ReorderRolesRequest {
  roleIds: string[];
}

export interface UpdateGuildRequest {
  name?: string;
  /** Sahipliği devretmek (yalnızca sahip) */
  ownerId?: string;
}

export interface BanRequest {
  reason?: string;
}

export interface Ban {
  user: User;
  reason: string | null;
  bannedAt: number;
}

/** Sesli sohbette üyeyi yönetmek; channelId: başka kanala taşı, null: sesten çıkar */
export interface VoiceModerationRequest {
  mute?: boolean;
  deaf?: boolean;
  channelId?: string | null;
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
  /** Kanalın tüm rol izinleri (verilirse eskilerinin yerine geçer) */
  overwrites?: PermissionOverwrite[];
}

export interface CreateMessageRequest {
  /** Dosya eklendiyse boş olabilir */
  content: string;
  /** Önce POST /api/channels/:id/attachments ile yüklenen dosyalar */
  attachmentIds?: string[];
  /** Aynı kanaldaki bir mesaja yanıt (eski sunucular bu alanı yok sayar, mesaj normal gider) */
  replyToId?: string;
  /** Yanıtta asıl yazar bildirilsin mi (Discord'daki "@ AÇIK"); verilmezse evet */
  replyMention?: boolean;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface AckRequest {
  messageId: string;
}

/**
 * Direkt mesaj başlatmak. Tek kişi: bire bir konuşma (varsa var olanı döner, 200; yoksa oluşturulur,
 * 201). Birden çok kişi: yeni grup (en fazla DM_GROUP_MAX_PARTICIPANTS kişi, sen dahil).
 */
export interface CreateDmRequest {
  /** Diğer katılımcılar (sen hariç) */
  userIds: string[];
  /** Grubun adı (yalnızca grupta) */
  name?: string | null;
}

/** Grubun adını değiştirmek; null ya da boş: ad kaldırılır */
export interface UpdateDmRequest {
  name: string | null;
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
  /** Yalnızca kullanıcının görebildiği kanallar */
  channels: Channel[];
  users: User[];
  /** @everyone dahil tüm roller */
  roles: Role[];
  voiceStates: VoiceState[];
  online: string[];
  /** Metin kanallarındaki en son mesaj kimliği (kanal → mesaj) */
  lastMessageIds: Record<string, string>;
  /** Bu kullanıcının kanal başına okuduğu son mesaj (kanal → mesaj) */
  readStates: Record<string, string>;
  /** Bu kullanıcının kanal başına okunmamış bahsetme sayısı */
  mentionCounts: Record<string, number>;
  /** Tek dosyanın en büyük boyutu (bayt); istemci yüklemeden önce denetler */
  attachmentMaxBytes: number;
  /**
   * Kullanıcının listesinde açık direkt mesaj konuşmaları. Yalnızca IDENTIFY'da 'dm' özelliğini bildiren
   * istemcilere gelir; bunların okunmamış bilgisi (son mesaj, okunan son mesaj, okunmamış mesaj sayısı)
   * kanallarınkiyle birlikte lastMessageIds / readStates / mentionCounts içindedir. DM'de karşı tarafın
   * her mesajı bahsetme gibi sayılır.
   */
  dms?: DmChannel[];
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
  | { t: 'GUILD_UPDATE'; d: Guild }
  /** Rollerden biri eklendi, değişti, silindi ya da sıralama değişti: tüm liste */
  | { t: 'ROLES_UPDATE'; d: { roles: Role[] } }
  /**
   * Yetkili biri seni başka ses kanalına taşıdı: seste olan istemci o kanala geçer. (Kendi sunucumuzdaki
   * LiveKit katılımcı taşımayı desteklemiyor; bu olayı tanımayan eski istemci bir süre sonra sesten çıkarılır.)
   */
  | { t: 'VOICE_MOVE'; d: { channelId: string } }
  | { t: 'MESSAGE_CREATE'; d: Message }
  | { t: 'MESSAGE_UPDATE'; d: MessageUpdate }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channelId: string } }
  | { t: 'MESSAGE_REACTION_ADD'; d: ReactionEvent }
  | { t: 'MESSAGE_REACTION_REMOVE'; d: ReactionEvent }
  | { t: 'TYPING_START'; d: { channelId: string; userId: string } }
  /**
   * Direkt mesaj olayları (yalnızca 'dm' özelliğini bildiren istemcilere, yalnızca katılımcılara).
   * CREATE: konuşma listende göründü (yeni, yeniden açıldı ya da gruba eklendin; mesaj olaylarından önce
   * gelir). UPDATE: grup adı ya da katılımcılar değişti. DELETE: listenden kalktı (kapattın ya da ayrıldın).
   */
  | { t: 'DM_CHANNEL_CREATE'; d: DmChannel }
  | { t: 'DM_CHANNEL_UPDATE'; d: DmChannel }
  | { t: 'DM_CHANNEL_DELETE'; d: { id: string } }
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
  /**
   * İstemcinin tanıdığı ek özellikler (bkz. CLIENT_FEATURE_*). Bildirilmeyen özelliğin verisi ve olayları
   * gönderilmez: ör. eski istemciler direkt mesajları tanımadığından onlara hiç DM gitmez.
   */
  features?: string[];
}

/** İstemci direkt mesajları tanıyor: READY'de `dms`, DM_CHANNEL_* ve DM mesaj olayları gelir */
export const CLIENT_FEATURE_DM = 'dm';

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
/** Bahsetme sözcükleri kullanıcı adı olamaz */
export const RESERVED_USERNAMES: readonly string[] = ['everyone', 'here'];
export const GUILD_NAME_MAX_LENGTH = 48;
export const BAN_REASON_MAX_LENGTH = 200;
export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 32;
export const CHANNEL_NAME_MAX_LENGTH = 48;
/** Grup DM'indeki en fazla kişi (kuran dahil) */
export const DM_GROUP_MAX_PARTICIPANTS = 10;
export const DM_NAME_MAX_LENGTH = 48;
export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_PAGE_SIZE = 50;
/** Yanıt özetindeki (referencedMessage.content) en fazla karakter */
export const REPLY_EXCERPT_LENGTH = 200;
/** Bir mesajdaki en fazla farklı emoji tepkisi sayısı */
export const MESSAGE_MAX_REACTIONS = 20;
/** Bir mesajdaki en fazla dosya sayısı */
export const MESSAGE_MAX_ATTACHMENTS = 10;
/** Sunucu ayarı yoksa tek dosyanın en büyük boyutu */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** Mesajın içinde resim olarak gösterilen türler (sunucu bunları dosyanın içeriğinden belirler) */
export const INLINE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const isImageAttachment = (a: Pick<Attachment, 'contentType'>): boolean =>
  INLINE_IMAGE_TYPES.includes(a.contentType);
/** Yüklenen profil fotoğrafının en büyük boyutu (PNG, JPEG, WebP ya da GIF; sunucu küçültür) */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
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

/**
 * Mesajın yanıtların üstünde gösterilen özeti. Sunucu okurken, istemci de ekrandaki yanıtları asıl
 * mesajın güncellemesiyle tazelerken aynı kuralı kullanır.
 */
export function referenceOf(
  message: Pick<Message, 'id' | 'authorId' | 'content'>,
  hasAttachments: boolean,
): ReferencedMessage {
  return {
    id: message.id,
    authorId: message.authorId,
    content: [...message.content].slice(0, REPLY_EXCERPT_LENGTH).join(''),
    hasAttachments,
  };
}

/** Metinde @everyone bahsetmesi var mı (yazarın yetkisi ayrıca denetlenir) */
export function mentionsEveryone(content: string): boolean {
  return /(?<![a-z0-9_.@])@everyone(?![a-z0-9_])/i.test(content);
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
