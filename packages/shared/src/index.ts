// Sunucu ve masaüstü istemcisi arasında paylaşılan tipler ve sabitler.

import type { Feedback } from './feedback';
import type { PermissionOverwrite, Role } from './permissions';
import type { Presence, SelfStatus } from './presence';

export * from './permissions';
export * from './feedback';
export * from './presence';
export * from './search';
export * from './telemetry';

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
  /**
   * Profil afişi: sunucu köküne göre adres (/api/banners/<kullanıcı>/<özet>.webp; 1020×360
   * WebP). Profil kartının üstünde; yoksa null (tema rengi ya da profil rengi gösterilir). Eski sunucularda yok.
   */
  bannerUrl?: string | null;
  /** Profil teması: kartın iki rengi (üstten alta degrade). Yoksa null: varsayılan kart */
  profileTheme?: ProfileTheme | null;
  /** Profil kartında oynayan efekt (bkz. PROFILE_EFFECTS). Yoksa null */
  profileEffect?: ProfileEffect | null;
  /**
   * Avatar dekorasyonunun kimliği (sunucunun kozmetik kataloğunda, bkz. CosmeticsCatalog). Yoksa null;
   * istemci katalogda bulamadığı kimliği göstermez.
   */
  avatarDecoration?: string | null;
  /** Profil kartının çerçevesinin kimliği (kozmetik kataloğunda). Yoksa null */
  profileFrame?: string | null;
  /**
   * Hesap yöneticisi: ana sunucunun (ilk kurulan sunucu) sahibi ya da orada Yönetici yetkili bir rolü var.
   * Hesaplarla ilgili işleri yapar (şifre sıfırlama kodu, hesap silme, hesap daveti, geri bildirimler).
   * Sunuculardaki yetkiler rollerden gelir (bkz. GuildMember).
   */
  isAdmin: boolean;
}

export interface Guild {
  id: string;
  name: string;
  /** Sahip: herkesin üstündedir, her yetkiye sahiptir */
  ownerId: string | null;
  /**
   * Sunucu simgesi: sunucu köküne göre adres (/api/guild-icons/<sunucu>/<özet>.webp; 256×256 WebP).
   * Kimlik doğrulaması istemez, içerik değişince adres de değişir. Yoksa null: adın baş harfleri gösterilir.
   */
  iconUrl?: string | null;
}

/**
 * Bir hesabın bir sunucudaki üyeliği. Sunucudan ayrılan, atılan ya da yasaklanan eski üyeler de listede
 * kalır (`removed`): mesajlarında adları görünsün diye; üye listesinde gösterilmezler.
 */
export interface GuildMember {
  userId: string;
  /** Rollerinin kimlikleri (@everyone hariç); eski üyede boş */
  roles: string[];
  joinedAt: number;
  /** Artık üye değil (ayrıldı, atıldı ya da yasaklandı) */
  removed: boolean;
}

/** Bir sunucunun kullanıcıya görünen hâli (READY'de ve GUILD_CREATE'te) */
export interface GuildData {
  guild: Guild;
  /** Yalnızca kullanıcının görebildiği kanallar */
  channels: Channel[];
  /** @everyone dahil tüm roller */
  roles: Role[];
  /** Üyeler (eski üyeler `removed` olarak) */
  members: GuildMember[];
}

/**
 * Kullanıcı bir sunucuya katıldı (ya da sunucu kurdu): sunucunun verisi ve ona ait anlık durum. `users`,
 * kullanıcının henüz tanımadığı üyelerin profillerini de içerir.
 */
export interface GuildCreatePayload extends GuildData {
  users: User[];
  voiceStates: VoiceState[];
  /** Bu sunucunun çevrimiçi üyeleri */
  online: string[];
  /** Çevrimiçi üyelerin durumları (eski sunucularda gelmez: hepsi 'online' sayılır) */
  presences?: Record<string, Presence>;
  lastMessageIds: Record<string, string>;
  readStates: Record<string, string>;
  mentionCounts: Record<string, number>;
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
  /** Yayının başladığı an (ms, sunucu saati); yalnızca yayındayken, eski sunucularda gelmez */
  streamStartedAt?: number;
  /** Paylaşılan pencerenin ya da ekranın adı (yayıncının bildirdiği, en çok 64 karakter) */
  streamSourceName?: string;
  /** Paylaşılan kaynağın türü */
  streamSourceKind?: StreamSourceKind;
  /**
   * Son yayın önizlemesinin zamanı (ms); önizleme yoksa gelmez. Değiştikçe istemci önizlemeyi yeniden
   * indirir (GET /api/voice/:channelId/stream-preview/:userId).
   */
  streamPreviewAt?: number;
}

export type StreamSourceKind = 'screen' | 'window';

/** PUT /api/voice/stream-source: yayıncı paylaştığı kaynağın adını bildirir */
export interface StreamSourceRequest {
  name: string;
  kind: StreamSourceKind;
}

/** Yayın önizlemesinin yüklenebilecek en büyük boyutu (bayt) */
export const STREAM_PREVIEW_MAX_BYTES = 256 * 1024;
/** Yayın önizlemesi kaynak adının en büyük uzunluğu */
export const STREAM_SOURCE_NAME_MAX_LENGTH = 64;

/** Mesaja eklenmiş dosya */
export interface Attachment {
  /** 128 bit rastgele kimlik (32 onaltılık karakter); adresin tahmin edilemeyen kısmı */
  id: string;
  /** Temizlenmiş dosya adı */
  name: string;
  /** Bayt */
  size: number;
  /**
   * Resim ve videolarda sunucunun dosya içeriğinden belirlediği tür (INLINE_IMAGE_TYPES,
   * INLINE_VIDEO_TYPES); diğerlerinde yükleyenin bildirdiği
   */
  contentType: string;
  /** Resim ve videolarda (okunabildiyse); resimde EXIF yönü, videoda döndürme uygulanmış hâliyle */
  width: number | null;
  height: number | null;
  /** Videolarda süre (saniye, okunabildiyse); eski sunucularda hiç gelmez */
  duration?: number | null;
  /**
   * Sunucu köküne göre adres: /api/attachments/<id>/<ad>. Kimlik doğrulaması istemez (resimler
   * <img> ile yüklenebilsin diye); adresi bilen herkes dosyayı alabilir, Discord'daki gibi.
   */
  url: string;
}

/**
 * Mesajdaki hareketli GIF (GIPHY). Metni yalnızca bir GIPHY bağlantısı olan mesaja sunucu ekler (GIF
 * seçiciden gönderilen ya da yapıştırılan bağlantı); bilgiler GIPHY'den alınır, istemci gönderemez.
 * Bu alanı bilmeyen eski istemciler mesajı düz bağlantı olarak görür. Medya GIPHY'nin sunucularından
 * doğrudan yüklenir (adresler https://media*.giphy.com / i.giphy.com ile sınırlıdır).
 */
export interface GifEmbed {
  type: 'gif';
  provider: 'giphy';
  /** GIPHY kimliği */
  id: string;
  /** GIPHY sayfası: mesajın metni bu bağlantıdır */
  url: string;
  title: string;
  /** Özgün boyut (yer ayırmak ve en-boy oranı için) */
  width: number;
  height: number;
  /** Hareketli GIF (2 MB'a kadar küçültülmüş hâli) */
  gif: string;
  /** Aynı görüntünün MP4 videosu (çok daha hafif; masaüstü bunu oynatır) */
  mp4: string | null;
  /** Hareketli WebP */
  webp: string | null;
  /** Durağan ilk kare */
  still: string | null;
}

/** Bağlantı önizlemesindeki resim: her zaman sunucumuz üzerinden (/api/embed-media/...) yüklenir */
export interface LinkEmbedImage {
  /** Sunucu köküne göre adres (imzalı; istemci asıl siteye bağlanmaz) */
  url: string;
  width: number;
  height: number;
}

/** Bağlantı önizlemesinin türü: sayfa kartı, doğrudan resim/GIF, doğrudan video ya da YouTube videosu */
export type LinkEmbedKind = 'article' | 'image' | 'video' | 'youtube';

/**
 * Mesajdaki bir bağlantının önizlemesi (Discord'daki "embed"). Mesaj gönderilince/düzenlenince sunucu
 * bağlantıları arka planda açar (OpenGraph, YouTube oEmbed) ve MESSAGE_UPDATE ile ekler; istemci
 * gönderemez. Metinler sunucuda temizlenir ve kısaltılır; düz metin olarak gösterilmelidir. Resimler
 * sunucumuz üzerinden gelir (kullanıcının IP'si sitelere gitmez). Bunu bilmeyen eski istemciler yok sayar
 * (yalnızca `type: 'gif'` gösterirler).
 */
export interface LinkEmbed {
  type: 'link';
  kind: LinkEmbedKind;
  /** Mesajdaki bağlantı (başlığa tıklanınca açılır) */
  url: string;
  /** Site adı (og:site_name; ör. "YouTube", "GitHub") */
  siteName: string | null;
  title: string | null;
  description: string | null;
  /** Yazar / kanal adı (YouTube kanalı, tweet yazarı) */
  author: string | null;
  /** Sol şeridin rengi (#rrggbb; sitenin theme-color'ı) */
  color: string | null;
  image: LinkEmbedImage | null;
  /** Resim kartın altında büyük mü (yoksa sağda küçük) gösterilsin */
  largeImage: boolean;
  /** kind 'youtube': video kimliği ve başlangıç saniyesi */
  youtubeId?: string | null;
  youtubeStart?: number | null;
  /** kind 'video': doğrudan video dosyası (asıl adres; yalnızca kullanıcı oynatınca yüklenir) */
  video?: { url: string } | null;
}

export type Embed = GifEmbed | LinkEmbed;

/** Bir mesajda en fazla bu kadar bağlantı önizlenir */
export const MESSAGE_MAX_LINK_EMBEDS = 5;

export const isLinkEmbed = (embed: Embed): embed is LinkEmbed => embed.type === 'link';

/** Mesajın bağlantı önizlemeleri (GIF'ler hariç) */
export const linkEmbedsOf = (message: { embeds?: readonly Embed[] | null }): LinkEmbed[] =>
  message.embeds?.filter(isLinkEmbed) ?? [];

/** GIF seçicideki bir sonuç: mesajdaki gösterimi ve ızgaradaki küçük önizlemesi */
export interface GifResult extends Omit<GifEmbed, 'type' | 'provider'> {
  /** 200 piksel genişliğinde önizleme */
  preview: { gif: string; webp: string | null; mp4: string | null; width: number; height: number };
}

/** GIF araması/popüler GIF'ler: bir sayfa sonuç; `next` sonraki sayfanın başlangıcı (yoksa null) */
export interface GifPage {
  results: GifResult[];
  next: number | null;
}

/** Sunucunun açık olan isteğe bağlı özellikleri (READY'de; eski sunucularda hiç gelmez) */
export interface ServerFeatures {
  /** GIF araması (sunucuda GIPHY anahtarı tanımlı) */
  gifs: boolean;
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
  /** Sunucunun eklediği gömülü içerik (GIPHY GIF'i, bağlantı önizlemeleri); eski sunucularda hiç gelmez */
  embeds?: Embed[];
  /**
   * Bağlantı önizlemeleri kaldırıldı ("Önizlemeyi kaldır"; yazar ya da MANAGE_MESSAGES): düzenlense de
   * yeniden eklenmez. Eski sunucularda hiç gelmez.
   */
  suppressEmbeds?: boolean;
  /** Yazarın yetkisi olan bir @everyone bahsetmesi: kanalı gören herkese bildirim gider */
  mentionEveryone: boolean;
  /**
   * Yazarın yetkisi olan (MENTION_EVERYONE) bir @here bahsetmesi: kanalı gören ve mesaj gönderildiğinde
   * çevrimiçi olan (gateway'e bağlı) herkese bildirim gider; çevrimdışı olanlar sayılmaz. Bunu bilmeyen
   * eski sunucularda hiç gelmez. İstemci vurgularken bunu @everyone gibi sayar (Discord gibi).
   */
  mentionHere?: boolean;
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
  /**
   * Mesaj kanala sabitlenmiş ("Sabitlenmiş mesajlar" listesinde). Sabitleme değişince MESSAGE_UPDATE ile
   * gelir. Bunu bilmeyen eski sunucularda hiç gelmez.
   */
  pinned?: boolean;
}

/** Sabitlenmiş mesajlar listesindeki mesaj (GET /api/channels/:id/pins): ne zaman ve kimin sabitlediği */
export interface PinnedMessage extends Message {
  pinned: true;
  pinnedAt: number;
  /** Sabitleyen (hesabı silindiyse null) */
  pinnedBy: string | null;
}

/** Bir kanalın sabitlenmiş mesajları değişti; son sabitlemenin zamanı (hiç kalmadıysa null) */
export interface ChannelPinsUpdate {
  channelId: string;
  lastPinAt: number | null;
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

/**
 * Bir mesajda belirli bir emojiyle tepki verenlerin bir sayfası (GET /api/messages/:id/reactions/:emoji),
 * tepki verilme sırasına göre. `next` doluysa sonraki sayfa için `?after=<next>` ile istenir.
 */
export interface ReactionUsersPage {
  users: User[];
  next: string | null;
}

/** Bir kullanıcı bir mesaja tepki verdi ya da tepkisini geri aldı */
export interface ReactionEvent {
  messageId: string;
  channelId: string;
  userId: string;
  emoji: string;
}

export interface Invite {
  code: string;
  /** Katılınacak sunucu; null: yalnızca hesap açtıran davet (sunucuya katılmaz) */
  guildId: string | null;
  createdBy: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
}

/** Davet bağlantısının önizlemesi (giriş gerekmez): hangi sunucuya davet edildiği */
export interface InvitePreview {
  code: string;
  /** Yalnızca hesap daveti ise null */
  guild: { id: string; name: string; iconUrl: string | null } | null;
  memberCount: number;
  expiresAt: number | null;
}

/** Sunucu davet bağlantısı: https://<sunucu>/davet/<kod> (indirme sayfası kodu gösterir) */
export const INVITE_LINK_PATH = '/davet/';

/** Yapıştırılan davet bağlantısından ya da koddan davet kodu (geçersizse null) */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  const fromLink = /\/davet\/([a-z0-9]+)/i.exec(text)?.[1];
  const code = (fromLink ?? text).toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

// ---------- REST ----------

export interface RegisterRequest {
  /** Hesap daveti ya da sunucu daveti (sunucu davetiyle kayıt olan o sunucuya da katılır) */
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
  /** null: temayı kaldırır */
  profileTheme?: ProfileTheme | null;
  /** null: efekti kaldırır */
  profileEffect?: ProfileEffect | null;
  /** Katalogdaki bir dekorasyon; null: kaldırır */
  avatarDecoration?: string | null;
  /** Katalogdaki bir çerçeve; null: kaldırır */
  profileFrame?: string | null;
}

/** Profil kartının iki rengi ("#rrggbb"): üstte primary, altta accent */
export interface ProfileTheme {
  primary: string;
  accent: string;
}

/** Profil efektleri: kodla çizilir (dosya yok); istemci tanımadığı efekti göstermez */
export const PROFILE_EFFECTS = ['snow', 'sparkles', 'petals'] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];
export const PROFILE_EFFECT_LABELS: Record<ProfileEffect, string> = {
  snow: 'Kar',
  sparkles: 'Işıltı',
  petals: 'Yapraklar',
};

/** "#rrggbb" */
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Kozmetik kataloğu (GET /api/cosmetics): avatar dekorasyonları ve profil çerçeveleri. Tasarımlar
 * sunucuda SVG olarak durur, sunucu saydam WebP'ye çevirip sunar (uygulamalar büyümez); adres içeriğin
 * özetini taşır, süresiz önbelleklenebilir.
 */
export interface CosmeticsCatalog {
  decorations: CosmeticItem[];
  frames: CosmeticItem[];
}

export interface CosmeticItem {
  id: string;
  name: string;
  /** Resmin sunucu köküne göre adresi (/api/cosmetics/<tür>/<kimlik>.webp?v=<özet>) */
  url: string;
}

/** Kozmetik kimliği: küçük harf, rakam, tire */
export const COSMETIC_ID = /^[a-z0-9-]{1,32}$/;

/**
 * Dekorasyon avatarın üstüne, ortalanarak bu kat büyüklükte çizilir (avatar resmin ortadaki %80'i);
 * yerleşimi değiştirmez.
 */
export const AVATAR_DECORATION_SCALE = 1.25;

/**
 * Profil çerçevesi dokuz dilimli kare resimdir: her kenardan resmin üçte biri köşedir (olduğu gibi
 * çizilir), aradaki şeritler kart boyunca esnetilir, orta boştur. Kartta köşeler bu kadar piksel çizilir.
 */
export const PROFILE_FRAME_SLICE = 1 / 3;
export const PROFILE_FRAME_BORDER = 40;

/** Afiş boyutu (piksel, 17:6); istemciler kartın genişliğine göre sığdırır */
export const BANNER_WIDTH = 1020;
export const BANNER_HEIGHT = 360;

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

export interface CreateGuildRequest {
  name: string;
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

/** Davetle katılınan sunucu (POST /api/invites/:code/accept) */
export interface AcceptInviteResponse {
  guild: Guild;
  /** Zaten üyeydin */
  alreadyMember: boolean;
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
  /** Kullanıcının üye olduğu sunucular, katılma sırasıyla (hiç yoksa boş) */
  guilds: GuildData[];
  /**
   * Kullanıcının görebildiği hesapların profilleri: ortak sunuculardaki (eski üyeler dahil) ve direkt mesaj
   * konuşmalarındaki kişiler
   */
  users: User[];
  /** Yalnızca görülebilen ses kanallarındakiler */
  voiceStates: VoiceState[];
  /** Ortak sunucularda çevrimiçi olanlar (görünmez olanlar hariç) */
  online: string[];
  /**
   * `online` listesindekilerin durumu ve özel durumu (eski sunucularda gelmez: hepsi 'online' sayılır).
   * Kullanıcının kendisi de, çevrimiçi görünüyorsa, buradadır (otomatik "boşta" dahil).
   */
  presences?: Record<string, Presence>;
  /** Kullanıcının kendi durum ayarları (eski sunucularda gelmez) */
  status?: SelfStatus;
  /**
   * Ana sunucu (ilk kurulan): hesap yöneticileri onun yöneticileridir, geri bildirimleri onu yönetenler
   * görür. Kullanıcı üyesi olmasa da bildirilir.
   */
  primaryGuildId: string | null;
  /** Metin kanallarındaki en son mesaj kimliği (kanal → mesaj) */
  lastMessageIds: Record<string, string>;
  /** Bu kullanıcının kanal başına okuduğu son mesaj (kanal → mesaj) */
  readStates: Record<string, string>;
  /** Bu kullanıcının kanal başına okunmamış bahsetme sayısı */
  mentionCounts: Record<string, number>;
  /** Tek dosyanın en büyük boyutu (bayt); istemci yüklemeden önce denetler */
  attachmentMaxBytes: number;
  /** İsteğe bağlı özellikler (ör. GIF araması); eski sunucularda hiç gelmez */
  features?: ServerFeatures;
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
  /** Profil değişti (ya da yeni tanınan biri) */
  | { t: 'USER_UPDATE'; d: User }
  | { t: 'USER_DELETE'; d: { id: string } }
  /**
   * Çevrimiçi durumu değişti. `online` eski istemciler içindir (boşta/rahatsız etmeyin = true, görünmez =
   * false); `status` ve `customStatus` eski sunucularda gelmez. Kullanıcının kendisine de gider.
   */
  | { t: 'PRESENCE_UPDATE'; d: { userId: string; online: boolean } & Partial<Presence> }
  /** Kendi durum ayarların değişti (başka cihazdan, süresi doldu ya da özel durum temizlendi) */
  | { t: 'USER_STATUS_UPDATE'; d: SelfStatus }
  | { t: 'CHANNEL_CREATE'; d: Channel }
  | { t: 'CHANNEL_UPDATE'; d: Channel }
  | { t: 'CHANNEL_DELETE'; d: { id: string; guildId?: string } }
  /** Bir sunucuya katıldın ya da sunucu kurdun */
  | { t: 'GUILD_CREATE'; d: GuildCreatePayload }
  | { t: 'GUILD_UPDATE'; d: Guild }
  /** Sunucu listenden çıktı: ayrıldın, atıldın, yasaklandın ya da sunucu silindi */
  | { t: 'GUILD_DELETE'; d: { id: string; reason?: string } }
  /** Sunucuya biri katıldı (ya da geri döndü) */
  | { t: 'GUILD_MEMBER_ADD'; d: { guildId: string; member: GuildMember; user: User } }
  /** Üyenin rolleri değişti */
  | { t: 'GUILD_MEMBER_UPDATE'; d: { guildId: string; member: GuildMember } }
  /** Üye sunucudan ayrıldı, atıldı ya da yasaklandı (eski üye olarak kalır) */
  | { t: 'GUILD_MEMBER_REMOVE'; d: { guildId: string; userId: string } }
  /** Sunucunun rollerinden biri eklendi, değişti, silindi ya da sıralama değişti: tüm liste */
  | { t: 'ROLES_UPDATE'; d: { guildId: string; roles: Role[] } }
  /**
   * Yetkili biri seni başka ses kanalına taşıdı: seste olan istemci o kanala geçer. (Kendi sunucumuzdaki
   * LiveKit katılımcı taşımayı desteklemiyor; bu olayı tanımayan eski istemci bir süre sonra sesten çıkarılır.)
   */
  | { t: 'VOICE_MOVE'; d: { channelId: string } }
  | { t: 'MESSAGE_CREATE'; d: Message }
  | { t: 'MESSAGE_UPDATE'; d: MessageUpdate }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channelId: string } }
  /**
   * Kanalın sabitlenmiş mesajları değişti (sabitlendi, sabitleme kaldırıldı ya da sabitli mesaj silindi).
   * Mesajın kendisi ayrıca MESSAGE_UPDATE (pinned) / MESSAGE_DELETE ile gelir. Eski istemciler yok sayar.
   */
  | { t: 'CHANNEL_PINS_UPDATE'; d: ChannelPinsUpdate }
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
  | { t: 'UPDATE_AVAILABLE'; d: { version: string } }
  /** Yeni geri bildirim (yalnızca Sunucuyu Yönet yetkililerine) */
  | { t: 'FEEDBACK_CREATE'; d: Feedback }
  /** Geri bildirimin durumu ya da notu değişti (yetkililere ve gönderene) */
  | { t: 'FEEDBACK_UPDATE'; d: Feedback }
  | { t: 'FEEDBACK_DELETE'; d: { id: number } };

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
/**
 * İstemci boşta olduğunu bildirir (IDLE_SET). Bunu bildiren bir masaüstü oturumu etkinken (boşta değil)
 * telefonlara bildirim gönderilmez: kişi mesajı zaten masaüstünde canlı görüyor.
 */
export const CLIENT_FEATURE_PRESENCE = 'presence';

export type GatewayClientMessage =
  | { t: 'IDENTIFY'; d: IdentifyPayload }
  | { t: 'HEARTBEAT' }
  | { t: 'VOICE_STATE_SET'; d: { selfMute: boolean; selfDeaf: boolean } }
  | { t: 'TYPING_START'; d: { channelId: string } }
  /** Bu oturum boşta mı (masaüstünde ~10 dk girdi yok ya da ekran kilitli; telefonda uygulama arka planda) */
  | { t: 'IDLE_SET'; d: { idle: boolean } };

// ---------- Sabitler ----------

export const GATEWAY_HEARTBEAT_INTERVAL_MS = 15_000;
/** Gateway kapanış kodu: istemci güncellenmeden yeniden bağlanmamalı */
export const GATEWAY_CLOSE_UPDATE_REQUIRED = 4010;

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/;
/** Bahsetme sözcükleri kullanıcı adı olamaz */
export const RESERVED_USERNAMES: readonly string[] = ['everyone', 'here'];
export const GUILD_NAME_MAX_LENGTH = 48;
/** Bir hesabın üye olabileceği en fazla sunucu */
export const MAX_GUILDS_PER_USER = 100;
/** Bir hesabın sahibi olabileceği en fazla sunucu */
export const MAX_OWNED_GUILDS = 10;
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
/** Bir kanalda (ya da direkt mesaj konuşmasında) en fazla sabitlenmiş mesaj sayısı */
export const MAX_PINS_PER_CHANNEL = 50;
/** Tepki verenler listesinin varsayılan ve en büyük sayfa boyutu */
export const REACTION_USERS_PAGE_SIZE = 50;
export const REACTION_USERS_MAX_PAGE_SIZE = 100;
/** Bir mesajdaki en fazla dosya sayısı */
export const MESSAGE_MAX_ATTACHMENTS = 10;
/** Sunucu ayarı yoksa tek dosyanın en büyük boyutu */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** Mesajın içinde resim olarak gösterilen türler (sunucu bunları dosyanın içeriğinden belirler) */
export const INLINE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const isImageAttachment = (a: Pick<Attachment, 'contentType'>): boolean =>
  INLINE_IMAGE_TYPES.includes(a.contentType);
/**
 * Mesajın içinde oynatılan video türleri (sunucu bunları dosyanın içeriğinden belirler: MP4/QuickTime
 * "ftyp" kutusu, WebM EBML başlığı). Matroska (.mkv) indirilebilir dosya olarak kalır.
 */
export const INLINE_VIDEO_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/quicktime'];

export const isVideoAttachment = (a: Pick<Attachment, 'contentType'>): boolean =>
  INLINE_VIDEO_TYPES.includes(a.contentType);
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
  message: Pick<Message, 'id' | 'authorId' | 'content'> & { embeds?: readonly Embed[] | null },
  hasAttachments: boolean,
): ReferencedMessage {
  return {
    id: message.id,
    authorId: message.authorId,
    // GIF mesajının metni GIPHY bağlantısıdır; özette bağlantı yerine "GIF" yazar (eski istemcilerde de)
    content: isGifMessage(message) ? GIF_SNIPPET : [...message.content].slice(0, REPLY_EXCERPT_LENGTH).join(''),
    hasAttachments,
  };
}

/** Yanıt özetinde ve bildirimlerde GIF mesajının metni */
export const GIF_SNIPPET = 'GIF';

/** Sunucunun GIF gömdüğü mesaj (metni yalnızca bir GIPHY bağlantısıdır) */
export const isGifMessage = (message: { embeds?: readonly Embed[] | null }): boolean =>
  message.embeds?.some((e) => e.type === 'gif') ?? false;

/**
 * Kod blokları (```…```) ve satır içi kod (`…`): içlerindeki @everyone / @here bahsetme sayılmaz
 * (istemcilerdeki biçimlendirme de bunları kod olarak gösterir).
 */
const CODE_SPANS = /```(?:[a-z0-9+#.-]+\n)?\n?[\s\S]*?\n?```|`[^`\n]+`/gi;

const withoutCode = (content: string): string => content.replace(CODE_SPANS, ' ');

/** Metindeki bağlantılar (istemcilerin bağlantı olarak gösterdiği biçim; bkz. client-core markdown) */
const URL_IN_TEXT = /(<)?(https?:\/\/[^\s<>"]*[^\s<>".,:;'!?)\]])(>)?/gi;
const SPOILERS = /\|\|[\s\S]+?\|\|/g;
// Paket DOM/Node türleri olmadan derlenir; URL her ortamda (tarayıcı, Node, Hermes) vardır.
declare const URL: new (input: string) => { protocol: string; username: string; password: string; hostname: string; href: string };
/** Önizlenecek bağlantının en fazla uzunluğu */
export const EMBED_URL_MAX_LENGTH = 2048;

/**
 * Önizlenecek bağlantılar (en fazla MESSAGE_MAX_LINK_EMBEDS, tekrarsız, metindeki sırayla). Kod blokları,
 * satır içi kod ve ||sürpriz|| içindekiler ile <https://…> biçiminde yazılanlar (Discord'daki gibi
 * önizlemeyi kapatma) sayılmaz. Kullanıcı adı/şifre içeren ya da çok uzun adresler atlanır.
 */
export function extractEmbedUrls(content: string): string[] {
  const text = withoutCode(content).replace(SPOILERS, ' ');
  const urls: string[] = [];
  for (const m of text.matchAll(URL_IN_TEXT)) {
    if (m[1] && m[3]) continue;
    const raw = m[2]!;
    if (raw.length > EMBED_URL_MAX_LENGTH) continue;
    let url: InstanceType<typeof URL>;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) continue;
    const href = url.href;
    if (!urls.includes(href)) urls.push(href);
    if (urls.length >= MESSAGE_MAX_LINK_EMBEDS) break;
  }
  return urls;
}

/** Metinde kod dışında @everyone bahsetmesi var mı (yazarın yetkisi ayrıca denetlenir) */
export function mentionsEveryone(content: string): boolean {
  return /(?<![a-z0-9_.@])@everyone(?![a-z0-9_])/i.test(withoutCode(content));
}

/**
 * Metinde kod dışında @here bahsetmesi var mı. @here, @everyone ile aynı yetkiyi (MENTION_EVERYONE)
 * ister ama yalnızca o an çevrimiçi olanlara (gateway'e bağlı) bildirim gider.
 */
export function mentionsHere(content: string): boolean {
  return /(?<![a-z0-9_.@])@here(?![a-z0-9_])/i.test(withoutCode(content));
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

/** Uygulama içi "Yenilikler" sayfasındaki bir sürüm (GET /api/releases) */
export interface ReleaseNotes {
  version: string;
  publishedAt: string;
  /** Sürüm notları (Markdown: başlıklar, madde işaretleri, kalın yazı) */
  notes: string;
}
