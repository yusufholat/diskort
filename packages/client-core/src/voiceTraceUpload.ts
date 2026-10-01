import { VOICE_TRACE_PENDING_MAX_MS, type VoiceTraceUpload } from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env } from './env';
import { gateway } from './gateway';
import { serverClock, type ServerClock } from './serverClock';
import { useSession } from './session';
import { VoiceTraceRecorder, type TraceCapture } from './voiceTrace';

/**
 * Olay kayıtlarının gönderimi: kesit bellekte tutulur ve sunucuya ulaşana kadar aralıklarla yeniden denenir
 * (en çok VOICE_TRACE_PENDING_MAX_MS). Kesinti sırasında alınan kayıt böylece bağlantı geri gelince (ses
 * odasından çıkılsa ya da yeniden bağlanılsa da) ulaşır. Her denemede gönderim anı (istemci saati) ve tahmini
 * saat farkı eklenir; sunucu ölçümleri kendi saatine çevirir.
 */

/** Yeniden deneme aralıkları (sonuncusu tekrarlanır) */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
/** Yanıt gelmeyen gönderim bu sürede bırakılır (sonra yeniden denenir) */
const SEND_TIMEOUT_MS = 20_000;
/** Bellekte bekleyen en fazla kesit (fazlasında en eskisi atılır) */
const MAX_PENDING = 5;

interface Pending {
  capture: TraceCapture;
  createdAt: number;
  attempt: number;
}

export class VoiceTraceUploader {
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  /** Sunucu desteklemiyor (404): bu oturumda bir daha denenmez */
  private unsupported = false;

  constructor(
    private readonly clock: Pick<ServerClock, 'offsetMs' | 'refresh'> = serverClock,
    private readonly now: () => number = Date.now,
  ) {}

  /** Bekleyen kesit sayısı (testler ve tanılama) */
  get pending(): number {
    return this.queue.length;
  }

  enqueue(capture: TraceCapture): void {
    if (this.unsupported) return;
    this.queue.push({ capture, createdAt: this.now(), attempt: 0 });
    if (this.queue.length > MAX_PENDING) this.queue.shift();
    void this.pump();
  }

  /** Bağlantı geri geldi (gateway READY): bekleyen kesit beklemeden denenir */
  kick(): void {
    if (this.queue.length === 0 || this.sending) return;
    this.clearTimer();
    void this.pump();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delay);
    // Node'da (testler) bekleyen zamanlayıcı süreci açık tutmasın
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0]!;
        if (this.now() - head.createdAt > VOICE_TRACE_PENDING_MAX_MS) {
          this.queue.shift();
          continue;
        }
        const result = await this.send(head);
        if (result === 'retry') {
          this.schedule(RETRY_DELAYS_MS[Math.min(head.attempt - 1, RETRY_DELAYS_MS.length - 1)]!);
          return;
        }
        if (result === 'unsupported') {
          this.unsupported = true;
          this.queue = [];
          return;
        }
        // Gönderildi ya da sunucu reddetti (yeniden denemek anlamsız)
        this.queue.shift();
      }
    } finally {
      this.sending = false;
    }
  }

  private async send(p: Pending): Promise<'done' | 'retry' | 'unsupported'> {
    p.attempt++;
    const token = useSession.getState().token;
    // Oturum yoksa (çıkış yapıldı) beklenir: süre dolunca kesit atılır
    if (!token) return 'retry';
    try {
      await this.clock.refresh();
      const { platform, version } = env();
      const c = p.capture;
      const body: VoiceTraceUpload = {
        v: 1,
        id: c.id,
        platform,
        version,
        channelId: c.channelId,
        reason: c.reason,
        reasons: c.reasons,
        eventId: c.eventId,
        triggerAt: c.triggerAt,
        sentAt: this.now(),
        offsetMs: this.clock.offsetMs,
        attempt: p.attempt,
        more: c.more,
        intervalMs: c.intervalMs,
        samples: c.samples,
        marks: c.marks,
      };
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), SEND_TIMEOUT_MS);
      const res = await fetch(`${normalizeServerUrl(env().serverUrl())}/api/telemetry/voice-trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: abort.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) return 'done';
      if (res.status === 404) return 'unsupported';
      // Sınır aşıldı ya da sunucu hatası: sonra yeniden; geçersiz gövde/yetki: atılır
      return res.status === 429 || res.status >= 500 ? 'retry' : 'done';
    } catch {
      return 'retry';
    }
  }
}

/** Uygulamadaki tek gönderici ve kayıt (ses motoru besler) */
export const voiceTraceUploader = new VoiceTraceUploader();
export const voiceTrace = new VoiceTraceRecorder({ onCapture: (capture) => voiceTraceUploader.enqueue(capture) });

// Sunucu isteği: seste değilsek (halka boş) hiçbir şey gönderilmez. Bağlantı geri gelince bekleyen kesit denenir.
gateway.on((msg) => {
  if (msg.t === 'VOICE_TRACE_REQUEST') {
    voiceTrace.requestCapture(Date.now(), msg.d.eventId, msg.d.reason, msg.d.channelId);
  } else if (msg.t === 'READY') {
    voiceTraceUploader.kick();
  }
});
