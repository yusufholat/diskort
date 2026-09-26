import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  GATEWAY_HEARTBEAT_INTERVAL_MS,
  type GatewayClientMessage,
  type GatewayServerMessage,
  type Guild,
  type User,
} from '@diskurt/shared';
import type { AuthService } from './auth.js';
import type { Store } from './db.js';
import type { VoiceStateStore } from './voiceState.js';

const IDENTIFY_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 20_000;

interface Session {
  socket: WebSocket;
  userId: string | null;
  alive: boolean;
}

/**
 * Gerçek zamanlı olay kanalı: kanal/kullanıcı/ses durumu değişikliklerini
 * bağlı tüm istemcilere iletir (Discord "gateway" benzeri).
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
  ) {
    voice.on('update', (state) => this.broadcast({ t: 'VOICE_STATE_UPDATE', d: state }));
    voice.on('delete', (d) => this.broadcast({ t: 'VOICE_STATE_DELETE', d }));
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

  broadcast(msg: GatewayServerMessage): void {
    const data = JSON.stringify(msg);
    for (const s of this.sessions) {
      if (s.userId && s.socket.readyState === s.socket.OPEN) s.socket.send(data);
    }
  }

  private send(s: Session, msg: GatewayServerMessage): void {
    if (s.socket.readyState === s.socket.OPEN) s.socket.send(JSON.stringify(msg));
  }

  private accept(socket: WebSocket): void {
    const session: Session = { socket, userId: null, alive: true };
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
      const user = await this.auth.userFromToken(msg.d.token);
      if (!user) {
        this.send(s, { t: 'INVALID_SESSION', d: { reason: 'Oturum geçersiz.' } });
        s.socket.close(4004, 'authentication failed');
        return;
      }
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
    }
  }

  private identify(s: Session, user: User): void {
    const wasOnline = this.isOnline(user.id);
    s.userId = user.id;
    let set = this.byUser.get(user.id);
    if (!set) this.byUser.set(user.id, (set = new Set()));
    set.add(s);

    this.send(s, {
      t: 'READY',
      d: {
        user,
        guild: this.guild,
        channels: this.store.listChannels(this.guild.id),
        users: this.store.listUsers(),
        voiceStates: this.voice.list(),
        online: [...this.byUser.keys()],
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
