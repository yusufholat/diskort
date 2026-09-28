import {
  CLIENT_FEATURE_DM,
  CLIENT_FEATURE_PRESENCE,
  GATEWAY_CLOSE_UPDATE_REQUIRED,
  type GatewayClientMessage,
  type GatewayServerMessage,
} from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env } from './env';
import { restoreActiveGuild, useGuild } from './guild';
import { useSession } from './session';

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000];
/** Öne gelince açık görünen bağlantının yoklaması: bu sürede HEARTBEAT_ACK gelmezse bağlantı ölü sayılır */
const RESUME_PROBE_MS = 5000;

type Listener = (msg: GatewayServerMessage) => void;

/** Sunucuyla gerçek zamanlı bağlantı; kopunca otomatik yeniden bağlanır ve durumu tazeler. */
class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** resume() yoklamasının zaman aşımı (HEARTBEAT_ACK gelince temizlenir) */
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private awaitingAck = false;
  private active = false;
  private listeners = new Set<Listener>();
  /** Bu cihaz boşta mı (masaüstünde girdi yok / ekran kilitli, telefonda uygulama arka planda) */
  private idle = false;
  /** Bu cihazın izlediği yayınlar (yayıncı kimlikleri, sıralı) */
  private watching: string[] = [];

  /**
   * Bağlantıyı başlatır. Zaten bağlıysa ya da bağlanıyorsa bir şey yapmaz: telefonda Android ekranı
   * (Activity) yeniden kurulunca arayüz baştan çizilir ve bu yeniden çağrılır; çalışan bağlantı
   * bozulmamalı (ikinci bir bağlantı da açılmamalı).
   */
  connect(): void {
    if (this.active && this.ws) return;
    this.active = true;
    this.attempts = 0;
    restoreActiveGuild();
    this.open();
  }

  disconnect(): void {
    this.active = false;
    this.watching = [];
    this.clearTimers();
    this.ws?.close(1000, 'logout');
    this.ws = null;
    useGuild.getState().reset();
  }

  /**
   * Bekleyen yeniden bağlanma denemesini beklemeden hemen bağlan (mobilde uygulama öne gelince ya da
   * ağ değişince). Bağlantı açık görünüyorsa hemen yoklanır: arka planda TCP yolu ölmüş olabilir ve
   * kapanış olayı dakikalarca gelmeyebilir. RESUME_PROBE_MS içinde yanıt gelmezse yeniden bağlanılır.
   */
  resume(): void {
    if (!this.active) return;
    const ws = this.ws;
    if (!ws) {
      this.attempts = 0;
      this.open();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN || this.probeTimer !== null) return;
    this.send({ t: 'HEARTBEAT' });
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.ws !== ws || !this.active) return;
      this.dropSocket('resume probe timeout');
      this.attempts = 0;
      this.open();
    }, RESUME_PROBE_MS);
  }

  /**
   * Bu cihazın boşta olup olmadığını bildirir. Tüm cihazların boştaysa (ve durumun "Çevrim içi" ise)
   * başkaları seni "Boşta" görür; elle seçilen durum değişmez. Yeniden bağlanınca yeniden bildirilir.
   */
  setIdle(idle: boolean): void {
    if (this.idle === idle) return;
    this.idle = idle;
    this.send({ t: 'IDLE_SET', d: { idle } });
  }

  /**
   * İzlenen yayınların tam listesini bildirir (yayıncı kimlikleri; boş liste izlemeyi bırakır). Yalnızca
   * değişince gönderilir; yeniden bağlanınca liste boş değilse yeniden bildirilir (sunucu kopan bağlantının
   * izlemesini siler). Seste olmayan cihaz hiç çağırmaz, böylece sesteki cihazın listesini ezmez.
   */
  setWatching(userIds: readonly string[]): void {
    const next = [...new Set(userIds)].sort();
    if (next.length === this.watching.length && next.every((id, i) => id === this.watching[i])) return;
    this.watching = next;
    this.send({ t: 'STREAM_WATCH_SET', d: { userIds: next } });
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

    const url = normalizeServerUrl(env().serverUrl()).replace(/^http/, 'ws') + '/gateway';
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
      // Sürüm eski: güncelleme ekranı açılır, yeniden bağlanmanın anlamı yok
      if (ev.code === GATEWAY_CLOSE_UPDATE_REQUIRED) return;
      if (this.active) this.scheduleReconnect();
    };
  }

  private handle(msg: GatewayServerMessage, token: string): void {
    switch (msg.t) {
      case 'HELLO':
        this.send({
          t: 'IDENTIFY',
          d: { token, version: env().version, platform: env().platform, features: [CLIENT_FEATURE_DM, CLIENT_FEATURE_PRESENCE] },
        });
        this.startHeartbeat(msg.d.heartbeatInterval);
        break;
      case 'READY':
        this.attempts = 0;
        useGuild.getState().setReady(msg.d);
        useSession.getState().setUser(msg.d.user);
        // Yeni oturum etkin sayılır; boştaysak hemen bildir
        if (this.idle) this.send({ t: 'IDLE_SET', d: { idle: true } });
        if (this.watching.length > 0) this.send({ t: 'STREAM_WATCH_SET', d: { userIds: this.watching } });
        break;
      case 'HEARTBEAT_ACK':
        this.awaitingAck = false;
        if (this.probeTimer !== null) clearTimeout(this.probeTimer);
        this.probeTimer = null;
        break;
      case 'INVALID_SESSION':
        // Ör. "Sunucudan çıkarıldın.", "Hesabın bir yönetici tarafından silindi."
        if (msg.d?.reason && useSession.getState().token) env().notifyError(msg.d.reason);
        useSession.getState().logout();
        break;
      case 'UPDATE_REQUIRED':
        env().onUpdateRequired?.(msg.d.version);
        break;
      case 'UPDATE_AVAILABLE':
        env().onUpdateAvailable?.(msg.d.version);
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
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingAck) {
        // Yanıt gelmedi: bağlantı ölü. Kapanış olayı ölü TCP yolunda ~1 dk gecikebilir; beklemeden
        // bırakılır ve yeniden bağlanılır.
        this.dropSocket('heartbeat timeout');
        if (this.active) this.scheduleReconnect();
        return;
      }
      this.awaitingAck = true;
      this.send({ t: 'HEARTBEAT' });
    }, interval);
  }

  /** Ölü sayılan bağlantıyı olaylarını ayırarak bırakır (geç gelen kapanış olayı artık bir şey yapmaz). */
  private dropSocket(reason: string): void {
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    if (!ws) return;
    ws.onmessage = null;
    ws.onclose = null;
    try {
      ws.close(4000, reason);
    } catch {
      // zaten kapanmış
    }
  }

  private scheduleReconnect(): void {
    useGuild.getState().setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.probeTimer = null;
  }
}

export const gateway = new GatewayClient();
