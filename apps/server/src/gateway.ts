import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  CLIENT_FEATURE_DM,
  CLIENT_FEATURE_PRESENCE,
  OFFLINE_PRESENCE,
  DEFAULT_ATTACHMENT_MAX_BYTES,
  GATEWAY_CLOSE_UPDATE_REQUIRED,
  GATEWAY_HEARTBEAT_INTERVAL_MS,
  Permission,
  sortRoles,
  type GatewayClientMessage,
  type GatewayServerMessage,
  type GuildCreatePayload,
  type GuildData,
  type ClientPlatform,
  type Presence,
  type PresenceStatus,
  type ReadStateUpdate,
  type ServerFeatures,
  type User,
} from '@diskort/shared';
import type { GatewayTraffic } from './apiStats.js';
import type { AuthService } from './auth.js';
import type { ClientVersionPolicy } from './clientVersion.js';
import type { Store } from './db.js';
import type { PermissionService } from './permissions.js';
import { StatusStore } from './presence.js';
import type { VoiceStateStore } from './voiceState.js';

const IDENTIFY_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 20_000;
/** Aynı kanal için "yazıyor" bildirimleri arasındaki en kısa süre (sel koruması) */
const TYPING_MIN_INTERVAL_MS = 1_000;

interface Session {
  socket: WebSocket;
  userId: string | null;
  alive: boolean;
  /** Kanal başına son "yazıyor" bildirimi (sel koruması) */
  lastTyping: Map<string, number>;
  /** İstemci direkt mesajları tanıyor (IDENTIFY'da bildirdi); tanımayana DM verisi ve olayı gitmez */
  dm: boolean;
  /** İstemcinin bildirdiği platform (bildirmeyen eski masaüstü sürümleri 'desktop') */
  platform: ClientPlatform;
  /** İstemcinin bildirdiği uygulama sürümü (yönetim paneli için) */
  version: string | null;
  /** Bağlantının açıldığı an */
  connectedAt: number;
  /** İstemci boşta olduğunu bildirebiliyor (CLIENT_FEATURE_PRESENCE) */
  reportsIdle: boolean;
  /** Oturum boşta (masaüstünde girdi yok / ekran kilitli, telefonda uygulama arka planda) */
  idle: boolean;
}

const OFFLINE_KEY = JSON.stringify(OFFLINE_PRESENCE);
/** Son bağlantısı kapanan hesap bu süre içinde yeniden bağlanırsa "yeniden bağlanma" sayılır */
const RECONNECT_WINDOW_MS = 60_000;

/** Kullanıcı → gördüğü kanallar (yetki değişikliğinden önceki durum) */
export type Visibility = Map<string, Set<string>>;

/**
 * Gerçek zamanlı olay kanalı: kanal/kullanıcı/ses durumu değişikliklerini bağlı istemcilere iletir
 * (Discord "gateway" benzeri). Her olay yalnızca onu görmesi gerekenlere gider: bir kanala ait olaylar
 * (mesajlar, tepkiler, "yazıyor", ses durumları, kanalın kendisi) o kanalı görebilenlere, bir sunucuya ait
 * olaylar (üyeler, roller, sunucunun kendisi) o sunucunun üyelerine, profil ve çevrimiçi bilgisi ortak
 * sunucusu (ya da direkt mesaj konuşması) olanlara.
 */
export class Gateway {
  private readonly sessions = new Set<Session>();
  private readonly byUser = new Map<string, Set<Session>>();
  private pingTimer: NodeJS.Timeout | null = null;
  /** Sunucu kapanıyor: kapanan bağlantılar için artık veritabanına bakılmaz */
  private closing = false;
  /** Kullanıcı → en son duyurulan durum (JSON); çevrimdışı görünenler yok. Aynı durum tekrar duyurulmaz. */
  private readonly announced = new Map<string, string>();
  /** Yönetim paneli: mesaj ve bağlantı sayaçları (sunucu açıldığından beri) */
  readonly traffic: GatewayTraffic = {
    messagesIn: 0,
    messagesOut: 0,
    bytesOut: 0,
    connections: 0,
    identified: 0,
    reconnects: 0,
    authFailures: 0,
    updateRequired: 0,
    closes: {},
  };
  /** Hesap → son bağlantısının kapandığı an (yeniden bağlanma sayımı) */
  private readonly lastClosed = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly voice: VoiceStateStore,
    private readonly permissions: PermissionService,
    private readonly clientVersions?: ClientVersionPolicy,
    private readonly attachmentMaxBytes = DEFAULT_ATTACHMENT_MAX_BYTES,
    private readonly features: ServerFeatures = { gifs: false },
    readonly statuses: StatusStore = new StatusStore(store),
  ) {
    // Kişi kendi ses durumunu her zaman alır (kanalı görme yetkisini kaybedip çıkarılırken de)
    voice.on('update', (state) =>
      this.dispatchChannel(state.channelId, { t: 'VOICE_STATE_UPDATE', d: state }, { include: state.userId }),
    );
    voice.on('delete', (d) => this.dispatchChannel(d.channelId, { t: 'VOICE_STATE_DELETE', d }, { include: d.userId }));
  }

  register(app: FastifyInstance): void {
    app.get('/gateway', { websocket: true }, (socket) => this.accept(socket));
    this.pingTimer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
    app.addHook('onClose', async () => {
      this.closing = true;
      if (this.pingTimer) clearInterval(this.pingTimer);
      for (const s of this.sessions) s.socket.terminate();
    });
  }

  /** Gateway'e bağlı (görünmez olsa da) */
  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Kullanıcının başkalarına görünen durumu: bağlı değilse ya da görünmezse çevrimdışı. Seçtiği durum
   * "Çevrim içi" iken tüm oturumları boştaysa "Boşta" (bir cihazda etkin olmak otomatik boştayı yener);
   * elle seçilen Boşta / Rahatsız Etmeyin olduğu gibi kalır.
   */
  presenceOf(userId: string): Presence {
    const sessions = this.byUser.get(userId);
    if (!sessions || sessions.size === 0) return OFFLINE_PRESENCE;
    const self = this.statuses.get(userId);
    if (self.status === 'invisible') return OFFLINE_PRESENCE;
    let status: PresenceStatus = self.status;
    if (status === 'online' && [...sessions].every((s) => s.idle)) status = 'idle';
    return { status, customStatus: self.customStatus };
  }

  /** Başkalarına çevrimiçi görünüyor (bağlı ve görünmez değil) */
  isVisible(userId: string): boolean {
    return this.presenceOf(userId).status !== 'offline';
  }

  /** Verilen kişilerden çevrimiçi görünenlerin durumları */
  private presences(userIds: Iterable<string>): Record<string, Presence> {
    const result: Record<string, Presence> = {};
    for (const id of userIds) {
      if (!this.byUser.has(id)) continue;
      const p = this.presenceOf(id);
      if (p.status !== 'offline') result[id] = p;
    }
    return result;
  }

  /**
   * Kullanıcının durum ayarı değişti (kendisi değiştirdi ya da süresi doldu): tüm cihazlarına yeni ayar,
   * görünen durumu değiştiyse onu görebilenlere PRESENCE_UPDATE.
   */
  statusChanged(userId: string): void {
    this.sendToUsers([userId], { t: 'USER_STATUS_UPDATE', d: this.statuses.get(userId) });
    this.announcePresence(userId);
  }

  /** Süresi dolan durumları ve özel durumları temizler (düzenli aralıkla çağrılır) */
  expireStatuses(now = Date.now()): void {
    if (this.closing) return;
    for (const id of this.statuses.expire(now)) this.statusChanged(id);
  }

  /**
   * Kişi şu an masaüstünde etkin mi: boşta olduğunu bildirebilen (yeni) bir masaüstü oturumu açık ve boşta
   * değil. Öyleyse mesajı zaten canlı görüyor; telefonuna bildirim gitmez. Boşta bildirmeyen eski masaüstü
   * sürümleri sayılmaz (tepside açık kalan uygulama bildirimleri sonsuza dek kesmesin).
   */
  activeOnDesktop(userId: string): boolean {
    for (const s of this.byUser.get(userId) ?? []) {
      if (s.platform === 'desktop' && s.reportsIdle && !s.idle) return true;
    }
    return false;
  }

  /**
   * Telefon bildirimi gidecekler: Rahatsız Etmeyin'de olanlar (hiç bildirim yok) ve o an masaüstünde etkin
   * olanlar çıkarılır. Okunmamış sayıları ve bahsetme sayıları bundan etkilenmez.
   */
  pushRecipients(userIds: string[]): string[] {
    return this.statuses.withoutDnd(userIds).filter((id) => !this.activeOnDesktop(id));
  }

  /** Kullanıcının tüm açık bağlantılarını kapatır (4004: istemci oturumu kapatır). */
  disconnectUser(userId: string, reason: string): void {
    for (const s of this.byUser.get(userId) ?? []) {
      this.send(s, { t: 'INVALID_SESSION', d: { reason } });
      s.socket.close(4004, 'session revoked');
    }
  }

  /** Tüm bağlı istemcilere gönderir (yalnızca herkesi ilgilendiren olaylar: ör. yeni sürüm). */
  broadcast(msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const s of this.sessions) {
      if (!s.userId) continue;
      if (s.socket.readyState === s.socket.OPEN) this.out(s, data);
    }
  }

  /**
   * Yalnızca kanalı görebilen kullanıcılara gönderir. Direkt mesaj konuşmasında bu, katılımcılardır (ve
   * yalnızca DM'leri tanıyan istemcileri).
   */
  dispatchChannel(
    channelId: string,
    msg: GatewayServerMessage,
    opts: { except?: string; include?: string } = {},
  ): void {
    const data = JSON.stringify(msg);
    const allowed = new Map<string, boolean>();
    const dm = this.permissions.isDm(channelId);
    for (const s of this.sessions) {
      if (!s.userId || s.userId === opts.except || (dm && !s.dm)) continue;
      let ok = allowed.get(s.userId);
      if (ok === undefined) {
        ok = s.userId === opts.include || this.permissions.canView(s.userId, channelId);
        allowed.set(s.userId, ok);
      }
      if (ok && s.socket.readyState === s.socket.OPEN) this.out(s, data);
    }
  }

  /** Belirli kullanıcılara gönderir (ör. kanal silinmeden önce onu görebilenler). */
  sendToUsers(userIds: Iterable<string>, msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const userId of new Set(userIds)) {
      for (const s of this.byUser.get(userId) ?? []) {
        if (s.socket.readyState === s.socket.OPEN) this.out(s, data);
      }
    }
  }

  /** Sunucunun şu anki üyelerine gönderir */
  sendToGuild(guildId: string, msg: GatewayServerMessage, exceptUserId?: string): void {
    this.sendToUsers(
      this.store.guildMemberIds(guildId).filter((id) => id !== exceptUserId),
      msg,
    );
  }

  /** Profil değişikliği: kullanıcıyı görebilen herkese (ortak sunucu, eski üyelik ya da DM) */
  sendUserUpdate(user: User): void {
    this.sendToUsers(this.store.observerIds(user.id), { t: 'USER_UPDATE', d: user });
  }

  /** Direkt mesaj olayını (DM_CHANNEL_*) belirli kullanıcıların DM'leri tanıyan oturumlarına gönderir. */
  sendDm(userIds: Iterable<string>, msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const userId of new Set(userIds)) {
      for (const s of this.byUser.get(userId) ?? []) {
        if (s.dm && s.socket.readyState === s.socket.OPEN) this.out(s, data);
      }
    }
  }

  /**
   * Okunma durumu ilerledi: kullanıcının bütün oturumlarına (onaylayan cihaz dahil; olay tekrarlansa da
   * zararsızdır). Direkt mesaj konuşmasındaysa yalnızca DM'leri tanıyan oturumlara.
   */
  sendReadState(userId: string, update: ReadStateUpdate | null): void {
    if (!update) return;
    const msg: GatewayServerMessage = { t: 'READ_STATE_UPDATE', d: update };
    if (this.permissions.isDm(update.channelId)) this.sendDm([userId], msg);
    else this.sendToUsers([userId], msg);
  }

  /** Bağlı kullanıcıların kimlikleri */
  connectedUserIds(): string[] {
    return [...this.byUser.keys()];
  }

  /** Kimliği doğrulanmış açık bağlantılar (yönetim paneli: platform, sürüm, boşta mı) */
  sessionsInfo(): { userId: string; platform: ClientPlatform; version: string | null; idle: boolean; connectedAt: number }[] {
    const result = [];
    for (const s of this.sessions) {
      if (!s.userId) continue;
      result.push({ userId: s.userId, platform: s.platform, version: s.version, idle: s.idle, connectedAt: s.connectedAt });
    }
    return result;
  }

  /** Bağlı kullanıcıların şu an gördüğü kanallar; yetkileri değiştirmeden önce alınır (bkz. syncVisibility). */
  visibility(): Visibility {
    const result: Visibility = new Map();
    for (const userId of this.byUser.keys()) result.set(userId, this.permissions.visibleChannelIds(userId));
    return result;
  }

  /**
   * Yetki değişikliğinden sonra her bağlı kullanıcının görünümünü günceller: görmeyi kaybettiği kanal
   * için CHANNEL_DELETE (+ oradaki ses durumlarının silinmesi), yeni gördüğü kanal için CHANNEL_CREATE
   * (+ oradaki ses durumları). `updated` kanallar (izinleri değişen) görmeye devam edenlere CHANNEL_UPDATE
   * olarak gider.
   */
  syncVisibility(before: Visibility, updated: Iterable<string> = []): void {
    const updatedIds = new Set(updated);
    const states = this.voice.list();
    for (const userId of this.byUser.keys()) {
      const prev = before.get(userId);
      if (!prev) continue; // değişiklik sırasında bağlandı: READY zaten güncel
      const next = this.permissions.visibleChannelIds(userId);
      const out: GatewayServerMessage[] = [];
      for (const id of prev) {
        if (next.has(id)) continue;
        for (const v of states) {
          if (v.channelId === id && v.userId !== userId) {
            out.push({ t: 'VOICE_STATE_DELETE', d: { userId: v.userId, channelId: id } });
          }
        }
        out.push({ t: 'CHANNEL_DELETE', d: { id } });
      }
      for (const id of next) {
        const channel = this.permissions.channel(id);
        if (!channel) continue;
        if (!prev.has(id)) {
          out.push({ t: 'CHANNEL_CREATE', d: channel });
          for (const v of states) if (v.channelId === id) out.push({ t: 'VOICE_STATE_UPDATE', d: v });
        } else if (updatedIds.has(id)) {
          out.push({ t: 'CHANNEL_UPDATE', d: channel });
        }
      }
      for (const msg of out) this.sendToUsers([userId], msg);
    }
  }

  /** Sunucunun kullanıcıya görünen hâli: görebildiği kanallar, roller, üyeler */
  guildData(guildId: string, userId: string): GuildData | null {
    const guild = this.store.getGuild(guildId);
    if (!guild) return null;
    return {
      guild,
      channels: this.permissions.visibleChannels(guildId, userId),
      roles: sortRoles(this.store.guildRoles(guildId)),
      members: this.store.listMembers(guildId),
    };
  }

  /**
   * Kullanıcı sunucuya katıldı (ya da kurdu): kendisine sunucunun tamamı (GUILD_CREATE), diğer üyelere
   * yeni üye (GUILD_MEMBER_ADD ve çevrimiçiyse PRESENCE_UPDATE).
   */
  announceJoin(guildId: string, userId: string): void {
    const payload = this.guildCreatePayload(guildId, userId);
    if (!payload) return;
    this.sendToUsers([userId], { t: 'GUILD_CREATE', d: payload });
    const member = this.store.getMember(guildId, userId);
    const user = this.store.getUser(userId);
    if (!member || !user) return;
    this.sendToGuild(guildId, { t: 'GUILD_MEMBER_ADD', d: { guildId, member, user } }, userId);
    const presence = this.presenceOf(userId);
    if (presence.status !== 'offline') {
      this.sendToGuild(guildId, { t: 'PRESENCE_UPDATE', d: { userId, online: true, ...presence } }, userId);
    }
  }

  /**
   * Kullanıcı sunucudan çıktı (ayrıldı, atıldı, yasaklandı): kendisinin listesinden kalkar (GUILD_DELETE),
   * diğer üyeler eski üye olarak görür (GUILD_MEMBER_REMOVE).
   */
  announceLeave(guildId: string, userId: string, reason?: string): void {
    this.sendToUsers([userId], { t: 'GUILD_DELETE', d: { id: guildId, ...(reason ? { reason } : {}) } });
    this.sendToGuild(guildId, { t: 'GUILD_MEMBER_REMOVE', d: { guildId, userId } }, userId);
    // Artık ortak sunucusu kalmayanlar birbirinin çevrimiçi durumunu görmez: son bilinen durum "çevrimdışı"
    const still = this.permissions.coMembers(userId);
    const parted = this.store.guildMemberIds(guildId).filter((id) => !still.has(id));
    const offline = { online: false, ...OFFLINE_PRESENCE };
    if (this.isVisible(userId)) this.sendToUsers(parted, { t: 'PRESENCE_UPDATE', d: { userId, ...offline } });
    for (const id of parted) {
      if (this.isVisible(id)) this.sendToUsers([userId], { t: 'PRESENCE_UPDATE', d: { userId: id, ...offline } });
    }
  }

  /** Üyenin rolleri değişti */
  announceMember(guildId: string, userId: string): void {
    const member = this.store.getMember(guildId, userId);
    if (member) this.sendToGuild(guildId, { t: 'GUILD_MEMBER_UPDATE', d: { guildId, member } });
  }

  private guildCreatePayload(guildId: string, userId: string): GuildCreatePayload | null {
    const data = this.guildData(guildId, userId);
    if (!data) return null;
    const visible = new Set(data.channels.map((c) => c.id));
    const onlyVisible = <T>(byChannel: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(byChannel).filter(([channelId]) => visible.has(channelId)));
    const memberIds = data.members.map((m) => m.userId);
    const current = new Set(data.members.filter((m) => !m.removed).map((m) => m.userId));
    const presences = this.presences(current);
    return {
      ...data,
      users: this.store.usersByIds(memberIds),
      voiceStates: this.voice.list().filter((v) => visible.has(v.channelId)),
      online: Object.keys(presences),
      presences,
      lastMessageIds: onlyVisible(this.store.lastMessageIds()),
      readStates: onlyVisible(this.store.readStates(userId)),
      mentionCounts: onlyVisible(this.store.mentionCounts(userId)),
    };
  }

  private send(s: Session, msg: GatewayServerMessage): void {
    if (s.socket.readyState === s.socket.OPEN) this.out(s, JSON.stringify(msg));
  }

  /** Tek giden mesaj (sayılarak) */
  private out(s: Session, data: string): void {
    this.traffic.messagesOut++;
    this.traffic.bytesOut += data.length;
    s.socket.send(data);
  }

  /** Açık WebSocket bağlantıları (kimliği doğrulanmamışlar dahil) */
  openSockets(): number {
    return this.sessions.size;
  }

  private accept(socket: WebSocket): void {
    const session: Session = {
      socket,
      userId: null,
      alive: true,
      lastTyping: new Map(),
      dm: false,
      platform: 'desktop',
      version: null,
      connectedAt: Date.now(),
      reportsIdle: false,
      idle: false,
    };
    this.sessions.add(session);
    this.traffic.connections++;
    this.send(session, { t: 'HELLO', d: { heartbeatInterval: GATEWAY_HEARTBEAT_INTERVAL_MS } });

    const identifyTimer = setTimeout(() => {
      if (!session.userId) socket.close(4001, 'identify timeout');
    }, IDENTIFY_TIMEOUT_MS);

    socket.on('pong', () => {
      session.alive = true;
    });

    socket.on('message', (raw) => {
      this.traffic.messagesIn++;
      let msg: GatewayClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as GatewayClientMessage;
      } catch {
        socket.close(4002, 'invalid payload');
        return;
      }
      void this.handle(session, msg).catch(() => socket.close(4000, 'internal error'));
    });

    socket.on('close', (code) => {
      clearTimeout(identifyTimer);
      this.sessions.delete(session);
      const key = String(code);
      this.traffic.closes[key] = (this.traffic.closes[key] ?? 0) + 1;
      if (!session.userId) return;
      const set = this.byUser.get(session.userId);
      set?.delete(session);
      if (set && set.size === 0) {
        this.byUser.delete(session.userId);
        if (this.lastClosed.size > 5_000) this.lastClosed.clear();
        this.lastClosed.set(session.userId, Date.now());
      }
      // Son oturum kapandıysa çevrimdışı; kalan oturumların hepsi boştaysa "Boşta"
      this.announcePresence(session.userId);
    });
  }

  /**
   * Görünen durum değiştiyse ortak sunucusu olanlara (ve kişinin kendisine) duyurur. Görünmez kullanıcı
   * hep çevrimdışı görünür: bağlanması, boşta olması ya da özel durumu hiçbir olay üretmez.
   */
  private announcePresence(userId: string, except?: Session): void {
    if (this.closing) return;
    const presence = this.presenceOf(userId);
    const key = JSON.stringify(presence);
    if (key === (this.announced.get(userId) ?? OFFLINE_KEY)) return;
    if (presence.status === 'offline') this.announced.delete(userId);
    else this.announced.set(userId, key);
    const data = JSON.stringify({
      t: 'PRESENCE_UPDATE',
      d: { userId, online: presence.status !== 'offline', ...presence },
    } satisfies GatewayServerMessage);
    for (const id of this.permissions.coMembers(userId)) {
      for (const s of this.byUser.get(id) ?? []) {
        if (s !== except && s.socket.readyState === s.socket.OPEN) this.out(s, data);
      }
    }
  }

  private async handle(s: Session, msg: GatewayClientMessage): Promise<void> {
    if (msg.t === 'IDENTIFY') {
      if (s.userId) return;
      // Zorunlu güncelleme: eski istemci önce güncellemeli (0.1.3 öncesi sürümler bu mesajı yok sayar
      // ve yeniden bağlanmayı dener; kendi güncelleyicileri yeni sürümü indirip kurar).
      const required = await this.clientVersions?.outdated(msg.d?.version, msg.d?.platform);
      if (required) {
        this.traffic.updateRequired++;
        this.send(s, { t: 'UPDATE_REQUIRED', d: { version: required } });
        s.socket.close(GATEWAY_CLOSE_UPDATE_REQUIRED, 'update required');
        return;
      }
      const user = await this.auth.userFromToken(msg.d.token);
      if (!user) {
        this.traffic.authFailures++;
        this.send(s, { t: 'INVALID_SESSION', d: { reason: 'Oturum geçersiz.' } });
        s.socket.close(4004, 'authentication failed');
        return;
      }
      const features = Array.isArray(msg.d.features) ? msg.d.features : [];
      s.dm = features.includes(CLIENT_FEATURE_DM);
      s.reportsIdle = features.includes(CLIENT_FEATURE_PRESENCE);
      const platform = msg.d.platform;
      s.platform = platform === 'android' || platform === 'ios' ? platform : 'desktop';
      s.version = typeof msg.d.version === 'string' && msg.d.version ? msg.d.version.slice(0, 32) : null;
      this.identify(s, user);
      return;
    }
    if (!s.userId) {
      s.socket.close(4003, 'not identified');
      return;
    }
    switch (msg.t) {
      case 'HEARTBEAT':
        this.send(s, { t: 'HEARTBEAT_ACK' });
        break;
      case 'VOICE_STATE_SET':
        this.voice.setSelf(s.userId, {
          selfMute: Boolean(msg.d.selfMute),
          selfDeaf: Boolean(msg.d.selfDeaf),
        });
        break;
      case 'IDLE_SET': {
        const idle = Boolean(msg.d?.idle);
        if (s.idle === idle) break;
        s.idle = idle;
        this.announcePresence(s.userId);
        break;
      }
      case 'TYPING_START': {
        const channelId = String(msg.d?.channelId ?? '');
        const now = Date.now();
        if (now - (s.lastTyping.get(channelId) ?? 0) < TYPING_MIN_INTERVAL_MS) break;
        const dm = this.permissions.isDm(channelId);
        if (dm ? !s.dm : this.permissions.channel(channelId)?.type !== 'text') break;
        if (!this.permissions.can(s.userId, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES, channelId)) break;
        s.lastTyping.set(channelId, now);
        this.dispatchChannel(channelId, { t: 'TYPING_START', d: { channelId, userId: s.userId } }, { except: s.userId });
        break;
      }
    }
  }

  private identify(s: Session, user: User): void {
    s.userId = user.id;
    this.traffic.identified++;
    const closedAt = this.lastClosed.get(user.id);
    if (closedAt !== undefined && Date.now() - closedAt <= RECONNECT_WINDOW_MS) this.traffic.reconnects++;
    this.lastClosed.delete(user.id);
    let set = this.byUser.get(user.id);
    if (!set) this.byUser.set(user.id, (set = new Set()));
    set.add(s);

    // Kullanıcı yalnızca üye olduğu sunucuları, oralarda görebildiği kanalları ve onlara ait bilgileri
    // alır. Direkt mesajlar ayrı alandadır ve yalnızca tanıyan istemciye gider.
    const guilds = this.store
      .userGuildIds(user.id)
      .map((id) => this.guildData(id, user.id))
      .filter((g): g is GuildData => g !== null);
    const dms = s.dm ? this.store.listDms(user.id) : undefined;
    const visible = new Set([
      ...guilds.flatMap((g) => g.channels.map((c) => c.id)),
      ...(dms ?? []).map((d) => d.id),
    ]);
    const onlyVisible = <T>(byChannel: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(byChannel).filter(([channelId]) => visible.has(channelId)));
    const coMembers = this.permissions.coMembers(user.id);
    const presences = this.presences([...this.byUser.keys()].filter((id) => coMembers.has(id)));
    this.send(s, {
      t: 'READY',
      d: {
        user,
        guilds,
        users: this.store.usersByIds(this.store.visibleUserIds(user.id)),
        voiceStates: this.voice.list().filter((v) => visible.has(v.channelId)),
        online: Object.keys(presences),
        presences,
        status: this.statuses.get(user.id),
        primaryGuildId: this.permissions.primaryGuildId,
        lastMessageIds: onlyVisible(this.store.lastMessageIds()),
        readStates: onlyVisible(this.store.readStates(user.id)),
        mentionCounts: onlyVisible(this.store.mentionCounts(user.id)),
        attachmentMaxBytes: this.attachmentMaxBytes,
        features: this.features,
        ...(dms ? { dms } : {}),
      },
    });
    // Yeni oturum kendi durumunu READY'de aldı
    this.announcePresence(user.id, s);
  }

  private pingAll(): void {
    for (const s of this.sessions) {
      if (!s.alive) {
        s.socket.terminate();
        continue;
      }
      s.alive = false;
      s.socket.ping();
    }
  }
}
