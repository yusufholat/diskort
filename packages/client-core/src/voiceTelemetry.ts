import {
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_MIN_GAP_MS,
  type TelemetryLimitation,
  type TelemetryMic,
  type TelemetryQuality,
  type TelemetryDevice,
  type TelemetryScreen,
  type TelemetryView,
  type TelemetryWatch,
  type VoiceTelemetryReport,
} from '@diskort/shared';
import { normalizeServerUrl } from './api';
import {
  isHardwareCodec,
  jitterBufferMs,
  mainInboundVideo,
  perFrameMs,
  type RtpStream,
  type TransportStats,
  type VideoCounters,
} from './connectionStats';
import { env } from './env';
import { useSession } from './session';

/**
 * Ses kalitesi ölçümü (yönetim paneli): platformun 2 saniyede bir aldığı bağlantı istatistiklerinden
 * (connectionStats) ~30 saniyelik özetler çıkarır ve sunucuya gönderir; kalite "kötü"ye düşünce özet hemen
 * gider (en fazla 10 sn'de bir). Yalnızca zaten ölçülen değerler toplanır, ek getStats çağrısı yok (gelen
 * akışlar için abonelik bağlantısı 10 sn'de bir okunur). Hatalar sessizce yutulur: görüşmeyi asla etkilemez.
 */

/** Abonelik bağlantısının (gelen akışlar) okunma aralığı */
export const TELEMETRY_SUBSCRIBER_EVERY_MS = 10_000;
/** Çıkarken son yarım özet ancak bu kadar ölçüm varsa gönderilir */
const MIN_FINAL_SAMPLES = 3;
/** Ölçümler arasında en fazla sayılan süre (uyku/donma sonrası uzun aralık "kötü" süresini şişirmesin) */
const MAX_STEP_MS = 10_000;

/** Platformun her özet için verdiği anlık bilgiler */
export interface TelemetryContext {
  channelId: string | null;
  mic: TelemetryMic | null;
  /** İzlenen yayının görünümü (tam ekran / küçük); bildirmeyen platformda yok */
  view?: TelemetryView | null;
  device?: TelemetryDevice | null;
}

export interface TelemetrySample {
  at: number;
  /** Yayın bağlantısının şimdiki ve bir önceki ölçümü */
  publisher: TransportStats | null;
  prevPublisher: TransportStats | null;
  /** Bu ölçümde okunduysa abonelik bağlantısı */
  subscriber: TransportStats | null;
  /** Son saniyelerin kalitesi (linkQuality) */
  quality: TelemetryQuality;
  /** LiveKit'in bildirdiği bağlantı kalitesi (excellent, good, poor, lost, unknown) */
  serverQuality?: string | null;
}

const SERVER_QUALITY_RANK: Record<string, number> = { excellent: 1, good: 2, poor: 3, lost: 4 };

class Mean {
  sum = 0;
  n = 0;
  max: number | null = null;
  add(v: number | null | undefined): void {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    this.sum += v;
    this.n++;
    if (this.max === null || v > this.max) this.max = v;
  }
  get avg(): number | null {
    return this.n ? this.sum / this.n : null;
  }
}

/** İki ölçüm arasında harcanan süre (sn) ve kare sayısı toplamları: ortalama ms/kare */
class FrameTime {
  sec = 0;
  frames = 0;
  add(time: number | null, prevTime: number | null, frames: number | null, prevFrames: number | null): void {
    if (time === null || prevTime === null || frames === null || prevFrames === null) return;
    const dFrames = frames - prevFrames;
    const dTime = time - prevTime;
    if (dFrames <= 0 || dTime < 0) return;
    this.sec += dTime;
    this.frames += dFrames;
  }
  get ms(): number | null {
    return this.frames > 0 ? (this.sec / this.frames) * 1000 : null;
  }
}

const round = (v: number | null, digits = 0): number | null => {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

const pct = (part: number, total: number): number | null => (total > 0 ? Math.min(100, (part / total) * 100) : null);

/** Giden görüntü akışları arasından ekran yayını: en büyük kare */
function screenStream(stats: TransportStats | null): RtpStream | null {
  let best: RtpStream | null = null;
  for (const s of stats?.streams ?? []) {
    if (s.direction !== 'out' || s.kind !== 'video') continue;
    const area = (s.frameWidth ?? 0) * (s.frameHeight ?? 0);
    if (!best || area > (best.frameWidth ?? 0) * (best.frameHeight ?? 0)) best = s;
  }
  return best;
}

function limitationOf(reason: string | null): TelemetryLimitation {
  if (reason === 'cpu' || reason === 'bandwidth' || reason === 'none') return reason;
  return reason ? 'other' : 'none';
}

/** Bir özet aralığında biriken değerler */
class Window {
  start = 0;
  lastAt = 0;
  samples = 0;
  poorMs = 0;
  quality: TelemetryQuality = 'unknown';
  serverQuality: string | null = null;
  rtt = new Mean();
  jitterOut = new Mean();
  jitterIn = new Mean();
  available = new Mean();
  sentPackets = 0;
  lostPackets = 0;
  outBits = 0;
  outMs = 0;
  inBits = 0;
  inMs = 0;
  inPackets = 0;
  inLost = 0;
  concealed = 0;
  audioSamples = 0;
  candidate: string | null = null;
  protocol: string | null = null;
  reconnects = 0;
  // Ekran yayını
  screenBits = 0;
  screenMs = 0;
  screenFps = new Mean();
  screenLast: RtpStream | null = null;
  limited = 0;
  limitSamples = 0;
  limitCounts: Record<TelemetryLimitation, number> = { none: 0, cpu: 0, bandwidth: 0, other: 0 };
  encode = new FrameTime();
  // İzlenen (gelen) yayın
  watchLast: RtpStream | null = null;
  watchBits = 0;
  watchMs = 0;
  watchFps = new Mean();
  decode = new FrameTime();
  /** ~10 sn'lik ölçümlerin kare başına çözme süreleri (en yükseği için) */
  decodeSteps = new Mean();
  jitterBuffer = new FrameTime();
  dropped: number | null = null;
  freezes: number | null = null;
  freezeSec: number | null = null;
}

/** Sayaç farkı (null: iki ölçümde de yoksa); sayaç sıfırlandıysa (yeni akış) 0 */
const addDelta = (acc: number | null, curr: number | null | undefined, prev: number | null | undefined): number | null =>
  curr === null || curr === undefined || prev === null || prev === undefined ? acc : (acc ?? 0) + Math.max(0, curr - prev);

function addCounters(w: Window, v: VideoCounters, p: VideoCounters): void {
  w.decode.add(v.totalTime, p.totalTime, v.frames, p.frames);
  w.decodeSteps.add(perFrameMs(v, p));
  w.jitterBuffer.add(v.jitterBufferDelay, p.jitterBufferDelay, v.jitterBufferEmittedCount, p.jitterBufferEmittedCount);
  w.dropped = addDelta(w.dropped, v.framesDropped, p.framesDropped);
  w.freezes = addDelta(w.freezes, v.freezeCount, p.freezeCount);
  w.freezeSec = addDelta(w.freezeSec, v.totalFreezesDuration, p.totalFreezesDuration);
}

export class VoiceTelemetry {
  private win = new Window();
  private lastSub: TransportStats | null = null;
  private lastSubAt = 0;
  private lastSentAt = 0;
  private prevQuality: TelemetryQuality = 'unknown';
  /** Sunucu desteklemiyor (404) ya da sınırladı (429): bu ana kadar gönderilmez */
  private pausedUntil = 0;
  private context: () => TelemetryContext = () => ({ channelId: null, mic: null });

  /** Platform bir kez verir: kanal ve mikrofon bilgisi özet anında okunur */
  setContext(fn: () => TelemetryContext): void {
    this.context = fn;
  }

  /** Bu ölçümde abonelik bağlantısı (gelen akışlar) da okunmalı mı */
  wantsSubscriber(at: number): boolean {
    return at - this.lastSubAt >= TELEMETRY_SUBSCRIBER_EVERY_MS;
  }

  /** Sese bağlanırken ve ayrılırken: yarım kalan özet gönderilir (yeterli ölçüm varsa), sayaçlar sıfırlanır */
  reset(): void {
    try {
      if (this.win.samples >= MIN_FINAL_SAMPLES) this.flush(this.win.lastAt);
    } catch {
      // ölçüm görüşmeyi etkilemez
    }
    this.win = new Window();
    this.lastSub = null;
    this.lastSubAt = 0;
    this.prevQuality = 'unknown';
  }

  /** LiveKit yeniden bağlanıyor (Reconnecting) */
  noteReconnect(): void {
    this.win.reconnects++;
  }

  /** Platformun 2 saniyelik ölçümü */
  sample(s: TelemetrySample): void {
    try {
      this.add(s);
    } catch {
      // ölçüm görüşmeyi etkilemez
    }
  }

  private add(s: TelemetrySample): void {
    // Uzun boşluk (uyku, donma): önceki aralık kendi sonunda kapanır, yenisi baştan başlar
    if (this.win.lastAt && s.at - this.win.lastAt > MAX_STEP_MS) {
      if (this.win.samples >= MIN_FINAL_SAMPLES) this.flush(this.win.lastAt);
      this.win = new Window();
    }
    const w = this.win;
    if (w.samples === 0) w.start = s.at - (w.lastAt ? Math.min(MAX_STEP_MS, s.at - w.lastAt) : 2_000);
    const step = w.lastAt ? Math.min(MAX_STEP_MS, Math.max(0, s.at - w.lastAt)) : 2_000;
    w.lastAt = s.at;
    w.samples++;
    if (s.quality === 'poor') w.poorMs += step;
    w.quality = s.quality;
    if (s.serverQuality && (SERVER_QUALITY_RANK[s.serverQuality] ?? 0) > (SERVER_QUALITY_RANK[w.serverQuality ?? ''] ?? 0)) {
      w.serverQuality = s.serverQuality;
    }

    const pub = s.publisher;
    const prev = s.prevPublisher;
    w.rtt.add(pub?.rttMs ?? s.subscriber?.rttMs ?? this.lastSub?.rttMs ?? null);
    if (pub) {
      w.available.add(pub.availableOutgoingBitrate);
      const route = pub.local;
      if (route) {
        w.candidate = route.candidateType;
        w.protocol = (route.candidateType === 'relay' ? route.relayProtocol : null) ?? route.protocol;
      }
      for (const st of pub.streams) if (st.direction === 'out' && st.kind === 'audio') w.jitterOut.add(st.jitterMs);
    }
    if (pub && prev) {
      const dt = pub.at - prev.at;
      if (dt > 0 && pub.bytesSent >= prev.bytesSent) {
        w.outBits += (pub.bytesSent - prev.bytesSent) * 8;
        w.outMs += dt;
      }
      const prevStreams = new Map(prev.streams.map((x) => [x.id, x]));
      for (const st of pub.streams) {
        const p = prevStreams.get(st.id);
        if (st.direction !== 'out' || !p) continue;
        w.sentPackets += Math.max(0, st.packets - p.packets);
        if (st.packetsLost !== null && p.packetsLost !== null) w.lostPackets += Math.max(0, st.packetsLost - p.packetsLost);
      }
      // Ekran yayını: kare, kare hızı, kodlayıcı ve kısıtlama nedeni
      const screen = screenStream(pub);
      if (screen) {
        const p = prevStreams.get(screen.id);
        if (p && dt > 0 && screen.bytes >= p.bytes) {
          w.screenBits += (screen.bytes - p.bytes) * 8;
          w.screenMs += dt;
        }
        if (p?.video && screen.video) {
          w.encode.add(screen.video.totalTime, p.video.totalTime, screen.video.frames, p.video.frames);
        }
        w.screenFps.add(screen.framesPerSecond);
        w.screenLast = screen;
        const reason = limitationOf(screen.qualityLimitationReason);
        w.limitCounts[reason]++;
        w.limitSamples++;
        if (reason !== 'none') w.limited++;
      }
    }

    if (s.subscriber) this.addSubscriber(s.subscriber);

    // Özet zamanı geldi ya da kalite "kötü"ye düştü
    const due = s.at - w.start >= TELEMETRY_INTERVAL_MS;
    const dropped = s.quality === 'poor' && this.prevQuality !== 'poor' && s.at - this.lastSentAt >= TELEMETRY_MIN_GAP_MS;
    this.prevQuality = s.quality;
    if (due || (dropped && w.samples >= 2)) {
      this.flush(s.at);
      this.win = new Window();
      this.win.lastAt = s.at;
    }
  }

  /** Gelen akışlar: iki okuma arasındaki kayıp, gizlenen ses ve bit hızı */
  private addSubscriber(sub: TransportStats): void {
    const w = this.win;
    const prev = this.lastSub;
    this.lastSub = sub;
    this.lastSubAt = sub.at;
    for (const st of sub.streams) if (st.direction === 'in' && st.kind === 'audio') w.jitterIn.add(st.jitterMs);
    // İzlenen yayın: çözücü, çözme süresi, atılan kare, donma
    const watched = mainInboundVideo(sub.streams);
    if (watched) {
      w.watchLast = watched;
      w.watchFps.add(watched.framesPerSecond);
    }
    if (!prev) return;
    const pw = watched ? prev.streams.find((x) => x.id === watched.id) : undefined;
    if (watched && pw) {
      const dt = sub.at - prev.at;
      if (dt > 0 && watched.bytes >= pw.bytes) {
        w.watchBits += (watched.bytes - pw.bytes) * 8;
        w.watchMs += dt;
      }
      if (watched.video && pw.video) addCounters(w, watched.video, pw.video);
    }
    const dt = sub.at - prev.at;
    if (dt > 0 && sub.bytesReceived >= prev.bytesReceived) {
      w.inBits += (sub.bytesReceived - prev.bytesReceived) * 8;
      w.inMs += dt;
    }
    const prevStreams = new Map(prev.streams.map((x) => [x.id, x]));
    for (const st of sub.streams) {
      const p = prevStreams.get(st.id);
      if (st.direction !== 'in' || !p) continue;
      const received = Math.max(0, st.packets - p.packets);
      const lost = st.packetsLost !== null && p.packetsLost !== null ? Math.max(0, st.packetsLost - p.packetsLost) : 0;
      w.inPackets += received + lost;
      w.inLost += lost;
      if (st.kind === 'audio' && st.concealedSamples !== null && p.concealedSamples !== null) {
        const total = (st.totalSamplesReceived ?? 0) - (p.totalSamplesReceived ?? 0);
        if (total > 0) {
          w.audioSamples += total;
          w.concealed += Math.max(0, st.concealedSamples - p.concealedSamples);
        }
      }
    }
  }

  private flush(at: number): void {
    const w = this.win;
    if (w.samples === 0) return;
    const ctx = this.context();
    if (!ctx.channelId) return;
    const { platform, version } = env();
    const last = w.screenLast;
    const screen: TelemetryScreen | null = last
      ? {
          width: last.frameWidth,
          height: last.frameHeight,
          fps: round(w.screenFps.avg, 1),
          bitrate: w.screenMs > 0 ? Math.round(w.screenBits / (w.screenMs / 1000)) : null,
          encoder: last.implementation,
          codec: last.codec,
          limitation: (Object.entries(w.limitCounts) as [TelemetryLimitation, number][])
            .filter(([k]) => k !== 'none')
            .sort((a, b) => b[1] - a[1])
            .find(([, n]) => n > 0)?.[0] ?? 'none',
          limitedRatio: w.limitSamples ? round(w.limited / w.limitSamples, 2) : null,
          encodeMs: round(w.encode.ms, 2),
          hardware: isHardwareCodec(last.implementation, last.video?.powerEfficient ?? null),
        }
      : null;
    const seen = w.watchLast;
    const watch: TelemetryWatch | null = seen
      ? {
          codec: seen.codec,
          decoder: seen.implementation,
          hardware: isHardwareCodec(seen.implementation, seen.video?.powerEfficient ?? null),
          powerEfficient: seen.video?.powerEfficient ?? null,
          width: seen.frameWidth,
          height: seen.frameHeight,
          fps: round(w.watchFps.avg, 1),
          // Aralıkta fark alınamadıysa (ilk okuma) baştan beri ortalama
          decodeMs: round(w.decode.ms ?? perFrameMs(seen.video, null), 2),
          decodeMsMax: round(w.decodeSteps.max, 2),
          bitrate: w.watchMs > 0 ? Math.round(w.watchBits / (w.watchMs / 1000)) : null,
          framesDropped: w.dropped,
          freezes: w.freezes,
          freezeSec: round(w.freezeSec, 1),
          jitterBufferMs: round(w.jitterBuffer.ms ?? jitterBufferMs(seen.video, null), 1),
          view: ctx.view ?? null,
        }
      : null;
    const report: VoiceTelemetryReport = {
      v: 1,
      platform,
      version,
      channelId: ctx.channelId,
      windowSec: Math.max(1, Math.round((at - w.start) / 1000)),
      samples: w.samples,
      quality: w.quality,
      poorSec: Math.round(w.poorMs / 1000),
      serverQuality: w.serverQuality,
      rttMs: { avg: round(w.rtt.avg), max: round(w.rtt.max) },
      jitterInMs: round(w.jitterIn.avg, 1),
      jitterOutMs: round(w.jitterOut.avg, 1),
      lossOutPct: round(pct(w.lostPackets, w.sentPackets), 2),
      lossInPct: round(pct(w.inLost, w.inPackets), 2),
      concealedPct: round(pct(w.concealed, w.audioSamples), 2),
      bitrateOut: w.outMs > 0 ? Math.round(w.outBits / (w.outMs / 1000)) : null,
      bitrateIn: w.inMs > 0 ? Math.round(w.inBits / (w.inMs / 1000)) : null,
      availableOut: round(w.available.avg),
      candidate: w.candidate,
      protocol: w.protocol,
      reconnects: w.reconnects,
      mic: ctx.mic,
      screen,
      watch,
      device: ctx.device ?? null,
    };
    this.lastSentAt = at;
    this.send(report);
  }

  private send(report: VoiceTelemetryReport): void {
    const now = Date.now();
    const token = useSession.getState().token;
    if (!token || now < this.pausedUntil) return;
    void fetch(`${normalizeServerUrl(env().serverUrl())}/api/telemetry/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
    })
      .then((res) => {
        // Eski sunucu: bu oturumda bir daha denenmez; sınır aşıldı: bir dakika ara
        if (res.status === 404) this.pausedUntil = Number.POSITIVE_INFINITY;
        else if (res.status === 429) this.pausedUntil = Date.now() + 60_000;
      })
      .catch(() => undefined);
  }
}

/** Uygulamadaki tek ölçüm toplayıcı (ses motoru besler) */
export const voiceTelemetry = new VoiceTelemetry();
