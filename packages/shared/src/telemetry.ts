// Ses kalitesi ölçümü (yönetim paneli): sesliyken istemci ~30 saniyede bir (kalite "kötü"ye düşünce hemen)
// kısa bir özet gönderir: POST /api/telemetry/voice. Yalnızca bağlantı ölçümleri vardır; mesaj içeriği,
// IP adresi ya da cihaz kimliği yoktur.

import type { ClientPlatform } from './index';

/** İstemcinin kendi bağlantısı için hesapladığı kalite (bkz. client-core linkQuality) */
export type TelemetryQuality = 'good' | 'fair' | 'poor' | 'unknown';

/** Yayın kodlayıcısının kaliteyi düşürme nedeni (WebRTC qualityLimitationReason) */
export type TelemetryLimitation = 'none' | 'cpu' | 'bandwidth' | 'other';

/** Min / ortalama / en yüksek; ölçüm yoksa alan null */
export interface TelemetryRange {
  avg: number | null;
  max: number | null;
}

/** Mikrofon işleme (gürültü engelleme) ölçümleri */
export interface TelemetryMic {
  /** Seçili gürültü engelleme: off, standard, deepfilter, dpdfnet… */
  noise: string;
  /** Çalışan model (ör. "DPDFNet-2 48k"); tarayıcı/WebRTC engellemesindeyse null */
  model: string | null;
  /** Modelin tek çekirdekteki yükü (0–1) */
  load: number | null;
  avgFrameMs: number | null;
  p99FrameMs: number | null;
  maxFrameMs: number | null;
  /** Bu aralıkta çıkış tamponu boşaldı / atılan örnek (duyulabilir kısa boşluklar) */
  underruns: number | null;
  droppedSamples: number | null;
  /** Mikrofon kapalıydı (aralığın sonunda) */
  muted: boolean;
}

/** Ekran paylaşımı (yalnızca yayındayken) */
export interface TelemetryScreen {
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Gönderilen görüntü bit hızı (bit/sn) */
  bitrate: number | null;
  /** ör. "NvEnc", "MediaFoundationVideoEncodeAccelerator", "libvpx" */
  encoder: string | null;
  /** ör. "video/H264" */
  codec: string | null;
  /** Aralıkta en sık görülen kısıtlama nedeni ve ölçümlerin kısıtlı geçen oranı (0–1) */
  limitation: TelemetryLimitation;
  limitedRatio: number | null;
}

/** POST /api/telemetry/voice gövdesi */
export interface VoiceTelemetryReport {
  v: 1;
  platform: ClientPlatform;
  version: string;
  /** Bağlı olunan ses kanalı */
  channelId: string;
  /** Özetin kapsadığı süre (sn) ve ölçüm (2 sn'de bir) sayısı */
  windowSec: number;
  samples: number;
  /** Aralığın sonundaki kalite ve "kötü" geçen süre (sn) */
  quality: TelemetryQuality;
  poorSec: number;
  /** LiveKit sunucusunun bildirdiği en kötü bağlantı kalitesi (excellent, good, poor, lost) */
  serverQuality: string | null;
  /** Gidiş-dönüş süresi (ms) */
  rttMs: TelemetryRange;
  /** Gelen seslerin titreşimi (ms) ve karşı tarafın bildirdiği giden titreşim */
  jitterInMs: number | null;
  jitterOutMs: number | null;
  /** Paket kaybı (%): giden (karşı tarafın raporu) ve gelen */
  lossOutPct: number | null;
  lossInPct: number | null;
  /** Gelen seste kayıp yüzünden sentezlenen örneklerin oranı (%) — "robotik ses" göstergesi */
  concealedPct: number | null;
  /** Ortalama bit hızları (bit/sn) */
  bitrateOut: number | null;
  bitrateIn: number | null;
  /** Tarayıcının tahmin ettiği kullanılabilir yükleme bant genişliği (bit/sn) */
  availableOut: number | null;
  /** Bağlantı yolu: host (doğrudan), srflx/prflx (NAT), relay (TURN); protokol udp/tcp/tls */
  candidate: string | null;
  protocol: string | null;
  /** Aralıktaki yeniden bağlanmalar */
  reconnects: number;
  mic: TelemetryMic | null;
  screen: TelemetryScreen | null;
}

/** Gönderim aralığı ve "kötü" anındaki erken gönderimler arasındaki en kısa süre */
export const TELEMETRY_INTERVAL_MS = 30_000;
export const TELEMETRY_MIN_GAP_MS = 10_000;
