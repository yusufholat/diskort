import {
  describeTransport,
  linkQuality,
  outboundDelta,
  parseTransportStats,
  pushSample,
  summarizePings,
  useGuild,
  voiceTelemetry,
  type LinkQuality,
  type PingSample,
  type TransportStats,
  type TelemetryContext,
  type TransportView,
} from '@diskort/client-core';
import type { TelemetryView } from '@diskort/shared';
import { Track, type Room } from 'livekit-client';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { getSettings } from '../stores/settings';
import { deviceSoc, effectiveNoiseMode, noiseFilterStats } from './noiseFilter';
import { voiceSettingsTelemetry } from './telemetrySettings';
import { useVoice, voice } from './voice';

/**
 * Ses bağlantısı istatistikleri (masaüstündeki bağlantı paneliyle aynı): sesliyken 2 saniyede bir
 * yayın bağlantısının ping'i ve giden paket kaybı ölçülür (grafik ve kalite rengi); bağlantı paneli
 * açıkken iki bağlantının ayrıntılı istatistikleri de toplanır. Rapor react-native-webrtc'nin
 * RTCPeerConnection.getStats()'ından gelir (tarayıcıyla aynı alan adları, id → kayıt Map'i).
 */

const STATS_INTERVAL_MS = 2000;
/** Kalite rengi son birkaç ölçümden hesaplanır */
const QUALITY_WINDOW_MS = 10_000;

/** Ses sunucusunun kimliği (bağlantı panelinde gösterilir) */
export interface VoiceServerInfo {
  /** ör. lk.ziroo.net */
  host: string;
  roomName: string;
  region: string | null;
  nodeId: string | null;
  version: string | null;
  e2ee: boolean;
}

/** Akışın kime/neye ait olduğu (track kimliğinden) */
export interface StreamLabel {
  label: string;
  /** Ekran yayını mı */
  screen: boolean;
}

export interface ConnectionDetail {
  at: number;
  publisher: TransportView | null;
  subscriber: TransportView | null;
  labels: Record<string, StreamLabel>;
  /** İzlenen yayının görünümü (izlenmiyorsa null) */
  view: TelemetryView | null;
}

/** İzlenen yayının görünümü: StreamViewer bildirir (tam ekran mı, fiziksel piksel boyutu) */
let streamView: TelemetryView | null = null;

export function noteStreamView(view: TelemetryView | null): void {
  streamView = view;
}

interface ConnectionStatsStore {
  /** Son 5 dakikanın ping ölçümleri (yalnızca sesliyken) */
  samples: PingSample[];
  quality: LinkQuality;
  server: VoiceServerInfo | null;
  /** Ayrıntılı istatistikler; yalnızca bağlantı paneli açıkken toplanır */
  detail: ConnectionDetail | null;
}

const EMPTY: ConnectionStatsStore = { samples: [], quality: 'unknown', server: null, detail: null };

export const useConnectionStats = create<ConnectionStatsStore>()(() => EMPTY);

/** Son ölçülen ping (ms); bilinmiyorsa null */
export const useLastPing = (): number | null =>
  useConnectionStats((s) => {
    for (let i = s.samples.length - 1; i >= 0; i--) {
      const rtt = s.samples[i]!.rttMs;
      if (rtt !== null) return i >= s.samples.length - 3 ? rtt : null;
    }
    return null;
  });

/** "wss://lk.ziroo.net/..." → "lk.ziroo.net" (React Native'in URL'si host okumayı desteklemiyor) */
function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0] || url;
}

function serverInfo(room: Room, url: string): VoiceServerInfo {
  const info = room.serverInfo;
  return {
    host: hostOf(url),
    roomName: room.name,
    region: info?.region || null,
    nodeId: info?.nodeId || null,
    version: info?.version || null,
    e2ee: room.isE2EEEnabled,
  };
}

/** getStats'taki track kimliklerini kullanıcı/kaynak adına çevirir */
function streamLabels(room: Room): Record<string, StreamLabel> {
  const labels: Record<string, StreamLabel> = {};
  const add = (id: string | undefined, label: string, screen: boolean): void => {
    if (id) labels[id] = { label, screen };
  };
  for (const pub of room.localParticipant.trackPublications.values()) {
    const screen = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
    const label =
      pub.source === Track.Source.Microphone ? 'Mikrofonun' : pub.source === Track.Source.ScreenShare ? 'Ekran yayının' : 'Yayın sesin';
    add(pub.track?.mediaStreamTrack?.id, label, screen);
    add(pub.track?.sender?.track?.id ?? undefined, label, screen);
  }
  const users = useGuild.getState().users;
  for (const p of room.remoteParticipants.values()) {
    const name = users[p.identity]?.displayName ?? (p.name || p.identity);
    for (const pub of p.trackPublications.values()) {
      const screen = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
      const what =
        pub.source === Track.Source.Microphone
          ? 'mikrofon'
          : pub.source === Track.Source.ScreenShare
            ? 'ekran yayını'
            : pub.source === Track.Source.ScreenShareAudio
              ? 'yayın sesi'
              : pub.kind;
      add(pub.track?.mediaStreamTrack?.id, `${name} · ${what}`, screen);
    }
  }
  return labels;
}

/** Ses kalitesi özetinin kanal ve mikrofon bilgisi (yönetim paneli; yalnızca ölçümler) */
function telemetryContext(): TelemetryContext {
  const v = useVoice.getState();
  const s = getSettings();
  const noise = effectiveNoiseMode();
  const ns = noise === 'dpdfnet' ? noiseFilterStats() : null;
  return {
    channelId: v.status === 'idle' ? null : v.channelId,
    mic: {
      noise,
      model: ns?.active ? 'DPDFNet (telefon)' : null,
      load: ns?.load ?? null,
      avgFrameMs: ns?.avgMs ?? null,
      p99FrameMs: null,
      maxFrameMs: ns?.maxMs ?? null,
      underruns: null,
      droppedSamples: null,
      muted: s.selfMute || s.selfDeaf || v.listenOnly || !v.micAllowed,
      // Isınma belirtisi: aynı çekirdekte kare süresi uzarsa işlemci kısılıyordur
      modelFrameMs: ns?.modelMs ?? null,
      core: ns?.audioCore ?? null,
    },
    view: v.watching ? streamView : null,
    device: { appState: AppState.currentState ?? null, soc: deviceSoc() },
    settings: voiceSettingsTelemetry(s),
  };
}

class ConnectionStatsSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private room: Room | null = null;
  private prev: { publisher: TransportStats | null; subscriber: TransportStats | null } = {
    publisher: null,
    subscriber: null,
  };
  private detailWatchers = 0;

  constructor() {
    voiceTelemetry.setContext(telemetryContext);
    // Sese bağlanınca başlar, ayrılınca durur (ölçümler sıfırlanır)
    useVoice.subscribe((next, prev) => {
      if (next.status === prev.status) return;
      if (next.status === 'idle') this.stop();
      else if (next.status === 'connected') this.start();
    });
  }

  private start(): void {
    const target = voice.statsTarget();
    if (!target) return;
    if (target.room !== this.room) {
      this.stop();
      this.room = target.room;
      useConnectionStats.setState({ server: serverInfo(target.room, target.url) });
    }
    if (this.timer === null) this.timer = setInterval(() => void this.collect(), STATS_INTERVAL_MS);
    void this.collect();
  }

  private stop(): void {
    voiceTelemetry.reset();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.room = null;
    this.prev = { publisher: null, subscriber: null };
    useConnectionStats.setState(EMPTY);
  }

  private async collect(): Promise<void> {
    const room = this.room;
    if (!room || this.busy) return;
    this.busy = true;
    try {
      const pcs = room.engine.pcManager;
      const detail = this.detailWatchers > 0;
      const at = Date.now();
      const pubReport = await pcs?.publisher.getStats()?.catch(() => undefined);
      const publisher = pubReport ? parseTransportStats(pubReport, at) : null;
      // Yayın bağlantısında ölçüm yoksa (ör. konuşma izni yok, yalnızca dinleniyor) ping abonelik bağlantısından
      const needSubscriber = detail || publisher?.rttMs == null || voiceTelemetry.wantsSubscriber(at);
      const subReport = needSubscriber ? await pcs?.subscriber?.getStats()?.catch(() => undefined) : undefined;
      const subscriber = subReport ? parseTransportStats(subReport, at) : null;
      if (room !== this.room) return;

      const prev = this.prev;
      this.prev = { publisher, subscriber };
      const rttMs = publisher?.rttMs ?? subscriber?.rttMs ?? null;
      const { sent, lost } = outboundDelta(publisher, prev.publisher);
      const samples = pushSample(useConnectionStats.getState().samples, { at, rttMs, sent, lost });
      const recent = summarizePings(samples, at - QUALITY_WINDOW_MS);
      const quality = linkQuality(recent.lastMs, recent.lossPercent);
      useConnectionStats.setState({
        samples,
        quality,
        // Sunucu bilgisi (bölge, sürüm) bağlandıktan sonra gelebilir
        server: this.serverFor(room),
        detail: detail
          ? {
              at,
              publisher: publisher && describeTransport(publisher, prev.publisher),
              subscriber: subscriber && describeTransport(subscriber, prev.subscriber),
              labels: streamLabels(room),
              view: useVoice.getState().watching ? streamView : null,
            }
          : null,
      });
      voiceTelemetry.sample({
        at,
        publisher,
        prevPublisher: prev.publisher,
        subscriber,
        quality,
        serverQuality: useVoice.getState().quality,
      });
    } catch {
      // Ölçülemeyen an grafikte boşluk olarak kalır
    } finally {
      this.busy = false;
    }
  }

  /** Değişmediyse aynı nesne (seçiciler gereksiz yere yeniden çizmesin) */
  private serverFor(room: Room): VoiceServerInfo | null {
    const current = useConnectionStats.getState().server;
    const target = voice.statsTarget();
    if (!target || target.room !== room) return current;
    const next = serverInfo(room, target.url);
    if (current && (Object.keys(next) as (keyof VoiceServerInfo)[]).every((k) => next[k] === current[k])) return current;
    return next;
  }

  /** Bağlantı paneli açıkken çağrılır; dönen işlev paneli kapatınca ayrıntılı ölçümü durdurur. */
  watchDetail(): () => void {
    this.detailWatchers++;
    void this.collect();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.detailWatchers = Math.max(0, this.detailWatchers - 1);
      if (this.detailWatchers === 0) useConnectionStats.setState({ detail: null });
    };
  }
}

export const connectionStats = new ConnectionStatsSampler();
