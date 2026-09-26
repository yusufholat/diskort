import type { GatewayClientMessage, GatewayServerMessage } from '@diskurt/shared';
import { normalizeServerUrl } from '../../lib/api';
import { useGuild } from '../../stores/guild';
import { useSession } from '../../stores/session';
import { getSettings } from '../../stores/settings';

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000];

type Listener = (msg: GatewayServerMessage) => void;

/** Sunucuyla gerçek zamanlı bağlantı; kopunca otomatik yeniden bağlanır ve durumu tazeler. */
class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private awaitingAck = false;
  private active = false;
  private listeners = new Set<Listener>();

  connect(): void {
    this.active = true;
    this.attempts = 0;
    this.open();
  }

  disconnect(): void {
    this.active = false;
    this.clearTimers();
    this.ws?.close(1000, 'logout');
    this.ws = null;
    useGuild.getState().reset();
  }

  send(msg: GatewayClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** READY dahil tüm olayları dinle. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private open(): void {
    const token = useSession.getState().token;
    if (!token || !this.active) return;
    this.clearTimers();

    const url = normalizeServerUrl(getSettings().serverUrl).replace(/^http/, 'ws') + '/gateway';
    const guild = useGuild.getState();
    guild.setStatus(guild.status === 'ready' || this.attempts > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (ev) => {
      let msg: GatewayServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as GatewayServerMessage;
      } catch {
        return;
      }
      this.handle(msg, token);
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (ev.code === 4004) {
        useSession.getState().logout();
        return;
      }
      if (this.active) this.scheduleReconnect();
    };
  }

  private handle(msg: GatewayServerMessage, token: string): void {
    switch (msg.t) {
      case 'HELLO':
        this.send({ t: 'IDENTIFY', d: { token } });
        this.startHeartbeat(msg.d.heartbeatInterval);
        break;
      case 'READY':
        this.attempts = 0;
        useGuild.getState().setReady(msg.d);
        useSession.getState().setUser(msg.d.user);
        break;
      case 'HEARTBEAT_ACK':
        this.awaitingAck = false;
        break;
      case 'INVALID_SESSION':
        useSession.getState().logout();
        break;
      case 'USER_UPDATE':
        useGuild.getState().apply(msg);
        if (msg.d.id === useSession.getState().user?.id) useSession.getState().setUser(msg.d);
        break;
      default:
        useGuild.getState().apply(msg);
    }
    for (const l of this.listeners) l(msg);
  }

  private startHeartbeat(interval: number): void {
    this.awaitingAck = false;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.awaitingAck) {
        // Yanıt gelmedi: bağlantı ölü, yeniden bağlan.
        this.ws?.close(4000, 'heartbeat timeout');
        return;
      }
      this.awaitingAck = true;
      this.send({ t: 'HEARTBEAT' });
    }, interval);
  }

  private scheduleReconnect(): void {
    useGuild.getState().setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempts++;
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }
}

export const gateway = new GatewayClient();
