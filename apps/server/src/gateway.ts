import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  CLIENT_FEATURE_DM,
  DEFAULT_ATTACHMENT_MAX_BYTES,
  GATEWAY_CLOSE_UPDATE_REQUIRED,
  GATEWAY_HEARTBEAT_INTERVAL_MS,
  Permission,
  sortRoles,
  type GatewayClientMessage,
  type GatewayServerMessage,
  type Guild,
  type ServerFeatures,
  type User,
} from '@diskort/shared';
import type { AuthService } from './auth.js';
import type { ClientVersionPolicy } from './clientVersion.js';
import type { Store } from './db.js';
import type { PermissionService } from './permissions.js';
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
}

/** Kullanıcı → gördüğü kanallar (yetki değişikliğinden önceki durum) */
export type Visibility = Map<string, Set<string>>;

/**
 * Gerçek zamanlı olay kanalı: kanal/kullanıcı/ses durumu değişikliklerini
 * bağlı istemcilere iletir (Discord "gateway" benzeri). Bir kanala ait olaylar (mesajlar, tepkiler,
 * "yazıyor", ses durumları, kanalın kendisi) yalnızca o kanalı görebilenlere gider.
 */
export class Gateway {
  private readonly sessions = new Set<Session>();
  private readonly byUser = new Map<string, Set<Session>>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly voice: VoiceStateStore,
    private readonly guild: Guild,
    private readonly permissions: PermissionService,
    private readonly clientVersions?: ClientVersionPolicy,
    private readonly attachmentMaxBytes = DEFAULT_ATTACHMENT_MAX_BYTES,
    private readonly features: ServerFeatures = { gifs: false },
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
      if (this.pingTimer) clearInterval(this.pingTimer);
      for (const s of this.sessions) s.socket.terminate();
    });
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  /** Kullanıcının tüm açık bağlantılarını kapatır (4004: istemci oturumu kapatır). */
  disconnectUser(userId: string, reason: string): void {
    for (const s of this.byUser.get(userId) ?? []) {
      this.send(s, { t: 'INVALID_SESSION', d: { reason } });
      s.socket.close(4004, 'session revoked');
    }
  }

  /** Tüm bağlı istemcilere gönderir; exceptUserId verilirse o kullanıcının oturumlarını atlar. */
  broadcast(msg: GatewayServerMessage, exceptUserId?: string): void {
    const data = JSON.stringify(msg);
    for (const s of this.sessions) {
      if (!s.userId || s.userId === exceptUserId) continue;
      if (s.socket.readyState === s.socket.OPEN) s.socket.send(data);
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
      if (ok && s.socket.readyState === s.socket.OPEN) s.socket.send(data);
    }
  }

  /** Belirli kullanıcılara gönderir (ör. kanal silinmeden önce onu görebilenler). */
  sendToUsers(userIds: Iterable<string>, msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const userId of new Set(userIds)) {
      for (const s of this.byUser.get(userId) ?? []) {
        if (s.socket.readyState === s.socket.OPEN) s.socket.send(data);
      }
    }
  }

  /** Direkt mesaj olayını (DM_CHANNEL_*) belirli kullanıcıların DM'leri tanıyan oturumlarına gönderir. */
  sendDm(userIds: Iterable<string>, msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const userId of new Set(userIds)) {
      for (const s of this.byUser.get(userId) ?? []) {
        if (s.dm && s.socket.readyState === s.socket.OPEN) s.socket.send(data);
      }
    }
  }

  /** Bağlı kullanıcıların kimlikleri */
  connectedUserIds(): string[] {
    return [...this.byUser.keys()];
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
   * olarak gider. Eski istemciler de kanal ekleme/silme olaylarını tanıdığı için doğru görünür.
   */
  syncVisibility(before: Visibility, updated: Iterable<string> = []): void {
    const updatedIds = new Set(updated);
    const channels = this.store.permissionData().channels;
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
        const channel = channels.get(id);
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

  private send(s: Session, msg: GatewayServerMessage): void {
    if (s.socket.readyState === s.socket.OPEN) s.socket.send(JSON.stringify(msg));
  }

  private accept(socket: WebSocket): void {
    const session: Session = { socket, userId: null, alive: true, lastTyping: new Map(), dm: false };
    this.sessions.add(session);
    this.send(session, { t: 'HELLO', d: { heartbeatInterval: GATEWAY_HEARTBEAT_INTERVAL_MS } });

    const identifyTimer = setTimeout(() => {
      if (!session.userId) socket.close(4001, 'identify timeout');
    }, IDENTIFY_TIMEOUT_MS);

    socket.on('pong', () => {
      session.alive = true;
    });

    socket.on('message', (raw) => {
      let msg: GatewayClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as GatewayClientMessage;
      } catch {
        socket.close(4002, 'invalid payload');
        return;
      }
      void this.handle(session, msg).catch(() => socket.close(4000, 'internal error'));
    });

    socket.on('close', () => {
      clearTimeout(identifyTimer);
      this.sessions.delete(session);
      if (!session.userId) return;
      const set = this.byUser.get(session.userId);
      set?.delete(session);
      if (set && set.size === 0) {
        this.byUser.delete(session.userId);
        this.broadcast({ t: 'PRESENCE_UPDATE', d: { userId: session.userId, online: false } });
      }
    });
  }

  private async handle(s: Session, msg: GatewayClientMessage): Promise<void> {
    if (msg.t === 'IDENTIFY') {
      if (s.userId) return;
      // Zorunlu güncelleme: eski istemci önce güncellemeli (0.1.3 öncesi sürümler bu mesajı yok sayar
      // ve yeniden bağlanmayı dener; kendi güncelleyicileri yeni sürümü indirip kurar).
      const required = await this.clientVersions?.outdated(msg.d?.version, msg.d?.platform);
      if (required) {
        this.send(s, { t: 'UPDATE_REQUIRED', d: { version: required } });
        s.socket.close(GATEWAY_CLOSE_UPDATE_REQUIRED, 'update required');
        return;
      }
      const user = await this.auth.userFromToken(msg.d.token);
      if (!user) {
        this.send(s, { t: 'INVALID_SESSION', d: { reason: 'Oturum geçersiz.' } });
        s.socket.close(4004, 'authentication failed');
        return;
      }
      const features = Array.isArray(msg.d.features) ? msg.d.features : [];
      s.dm = features.includes(CLIENT_FEATURE_DM);
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
      case 'TYPING_START': {
        const channelId = String(msg.d?.channelId ?? '');
        const now = Date.now();
        if (now - (s.lastTyping.get(channelId) ?? 0) < TYPING_MIN_INTERVAL_MS) break;
        const dm = this.permissions.isDm(channelId);
        if (dm ? !s.dm : this.store.permissionData().channels.get(channelId)?.type !== 'text') break;
        if (!this.permissions.can(s.userId, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES, channelId)) break;
        s.lastTyping.set(channelId, now);
        this.dispatchChannel(channelId, { t: 'TYPING_START', d: { channelId, userId: s.userId } }, { except: s.userId });
        break;
      }
    }
  }

  private identify(s: Session, user: User): void {
    const wasOnline = this.isOnline(user.id);
    s.userId = user.id;
    let set = this.byUser.get(user.id);
    if (!set) this.byUser.set(user.id, (set = new Set()));
    set.add(s);

    // Kullanıcı yalnızca görebildiği kanalları ve onlara ait bilgileri alır. Direkt mesajlar ayrı alandadır
    // (eski istemciler tanımadıkları türü kanal listesinde göstermesin) ve yalnızca tanıyan istemciye gider.
    const channels = this.permissions.visibleChannels(user.id);
    const dms = s.dm ? this.store.listDms(user.id) : undefined;
    const visible = new Set([...channels.map((c) => c.id), ...(dms ?? []).map((d) => d.id)]);
    const onlyVisible = <T>(byChannel: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(byChannel).filter(([channelId]) => visible.has(channelId)));
    this.send(s, {
      t: 'READY',
      d: {
        user,
        guild: this.store.getGuild() ?? this.guild,
        channels,
        users: this.store.listUsers(),
        roles: sortRoles(Object.values(this.store.permissionData().roles)),
        voiceStates: this.voice.list().filter((v) => visible.has(v.channelId)),
        online: [...this.byUser.keys()],
        lastMessageIds: onlyVisible(this.store.lastMessageIds()),
        readStates: onlyVisible(this.store.readStates(user.id)),
        mentionCounts: onlyVisible(this.store.mentionCounts(user.id)),
        attachmentMaxBytes: this.attachmentMaxBytes,
        features: this.features,
        ...(dms ? { dms } : {}),
      },
    });
    if (!wasOnline) this.broadcast({ t: 'PRESENCE_UPDATE', d: { userId: user.id, online: true } });
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
