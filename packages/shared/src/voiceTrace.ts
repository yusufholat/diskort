// Olay kaydı (ses/yayın sorunlarının saniyelik izi). İstemci sesliyken bağlantı ölçümlerini saniyede bir
// (telefonda 2 sn'de bir) kısa anahtarlı kayıtlar olarak ~120 sn'lik halka tamponda tutar; bir sorun
// tetiklenince (ya da sunucu isteyince) ilgili kesiti gönderir: POST /api/telemetry/voice-trace.
// Yalnızca bağlantı ölçümleri vardır: IP adresi, aday adresi, mesaj içeriği ya da cihaz kimliği yoktur
// (aday TÜRÜ ve protokol vardır; 30 sn'lik özetle aynı).

import type { ClientPlatform } from './index';

/** İstemci olay kaydı isteğini (VOICE_TRACE_REQUEST) tanıyor; bildirmeyen oturuma istek gönderilmez */
export const CLIENT_FEATURE_VOICE_TRACE = 'voice_trace';

/** Halka tamponun kapsadığı süre */
export const VOICE_TRACE_RING_MS = 120_000;
/** Tetiklemeden önceki ve sonraki süre (gönderim tetiklemeden bu kadar sonra yapılır) */
export const VOICE_TRACE_PRE_MS = 60_000;
export const VOICE_TRACE_POST_MS = 20_000;
/** İstemcinin kendi tetiklemeleriyle iki gönderim arasındaki en kısa süre */
export const VOICE_TRACE_MIN_GAP_MS = 60_000;
/** Sunucu isteğiyle iki gönderim arasındaki en kısa süre */
export const VOICE_TRACE_REQUEST_GAP_MS = 10_000;
/** Gönderilemeyen kayıt bellekte en çok bu kadar bekler (yeniden denenir) */
export const VOICE_TRACE_PENDING_MAX_MS = 5 * 60_000;
/** Tek gönderimdeki en fazla ölçüm ve işaret */
export const VOICE_TRACE_MAX_SAMPLES = 150;
export const VOICE_TRACE_MAX_MARKS = 40;
/** Gövde sınırı (bayt) */
export const VOICE_TRACE_MAX_BYTES = 256 * 1024;

/**
 * Giden akışın türü: mic (mikrofon), scr (ekran görüntüsü), sau (yayın sesi); platform bilemiyorsa
 * a (ses) / v (görüntü).
 */
export type VoiceTraceUplinkKind = 'mic' | 'scr' | 'sau' | 'a' | 'v';

/**
 * Giden akış (tür başına toplam; simulcast katmanları toplanır). Sayaçlar bir önceki ölçümden bu yana
 * FARKtır. Alan yoksa (undefined/null) değer bilinmiyordur.
 */
export interface VoiceTraceUp {
  k: VoiceTraceUplinkKind;
  /** Gönderilen paket ve bayt */
  ps: number;
  bs: number;
  /** Karşı tarafın (SFU alıcı raporu, remote-inbound-rtp) kayıp bildirdiği paket */
  pl?: number | null;
  /** Son alıcı raporundaki kayıp oranı (%) */
  fl?: number | null;
  /**
   * Bu ölçümde yeni alıcı raporu gelen akış sayısı (0: rapor gelmedi, `pl` bu yüzden 0'dır); istemci
   * raporun geliş anını bildirmiyorsa alan yoktur
   */
  rr?: number | null;
  /** SSRC başına gidiş-dönüş süresi ve karşı tarafın titreşimi (ms) */
  rtt?: number | null;
  jt?: number | null;
  // --- yalnızca görüntü (kodlayıcı) ---
  /** Hedef bit hızı (bit/sn) */
  tb?: number | null;
  /** Kodlanan / gönderilen kare, anahtar kare, "dev" kare (ortalamanın 2,5 katından büyük) */
  fe?: number | null;
  fs?: number | null;
  kf?: number | null;
  hf?: number | null;
  /** Alınan NACK / PLI / FIR */
  nk?: number | null;
  pli?: number | null;
  fir?: number | null;
  /** Yeniden gönderilen bayt / paket */
  rb?: number | null;
  rp?: number | null;
  /** qualityLimitationReason: none, cpu, bandwidth, other */
  ql?: string | null;
  /** Kare boyutu ve kare hızı */
  w?: number | null;
  h?: number | null;
  fps?: number | null;
  /** Kare başına kodlama süresi (ms) */
  em?: number | null;
  /** totalPacketSendDelay farkı (ms): paketlerin gönderim kuyruğunda beklediği toplam süre */
  sd?: number | null;
}

/** Taşıma (seçili aday çifti) */
export interface VoiceTraceTransport {
  /** Seçili aday çiftinin sıra numarası (çift değiştikçe artar; adres/kimlik içermez) */
  pi: number;
  /** Bu ölçümde çift değişti */
  pch?: 1;
  /** currentRoundTripTime (ms) — son STUN yanıtından; yanıt gelmiyorsa ESKİ değerdir (bkz. su) */
  rtt: number | null;
  /** STUN isteği gönderildi / yanıtı alındı (fark) */
  sq: number | null;
  sr: number | null;
  /** "STUN yanıtsız": yanıtlanmamış ilk istekten beri geçen süre (ms); 0: yol canlı */
  su: number;
  /** Tahmini kullanılabilir yükleme / indirme bant genişliği (bit/sn) */
  ao: number | null;
  ai: number | null;
  /** Gönderilen / alınan bayt (fark) */
  bs: number | null;
  br: number | null;
  /** packetsDiscardedOnSend farkı (soket gönderemedi) */
  pd: number | null;
  /** ICE ve bağlantı durumu, LiveKit'in bildirdiği kalite */
  ice?: string | null;
  pc?: string | null;
  lk?: string | null;
  /** Aday türü (host/srflx/prflx/relay) ve protokol (udp/tcp/tls) */
  ct?: string | null;
  pr?: string | null;
}

/** Gelen sesler (tüm ses akışlarının toplamı) */
export interface VoiceTraceDownAudio {
  /** Paket gelen akış sayısı */
  n: number;
  /** Alınan / kaybolan paket, bayt */
  pr: number;
  pl: number;
  bs: number;
  /** En yüksek titreşim (ms) */
  j: number | null;
  /** Çalınan örnek, bunlardan gizlenen (sessizlik hariç) ve gizleme olayı */
  ss: number | null;
  cs: number | null;
  ce: number | null;
}

/** Gelen (izlenen) görüntü akışı */
export interface VoiceTraceDownVideo {
  /** Akışın sıra numarası (aynı akış aynı numarayı taşır) */
  i: number;
  pr: number;
  pl: number | null;
  bs: number;
  j: number | null;
  /** Çözülen kare, çözülen anahtar kare */
  fd: number | null;
  kf: number | null;
  /** Donma sayısı ve donmaların süresi (ms) */
  fz: number | null;
  fzd: number | null;
  /** Atılan kare, atılan paket */
  dr: number | null;
  pdc?: number | null;
  /** Gönderilen NACK / PLI */
  nk: number | null;
  pli: number | null;
  /** Kare başına titreşim tamponu gecikmesi (ms), kare hızı ve boyut */
  jb: number | null;
  fps: number | null;
  w: number | null;
  h: number | null;
}

/** Tek ölçüm */
export interface VoiceTraceSample {
  /** Sıra numarası (tekdüze artar; atlama: gönderilmeyen ölçüm) */
  q: number;
  /** İstemci saati (Unix ms) ve bir önceki ölçümden bu yana geçen süre (ms) */
  t: number;
  dt: number;
  x: VoiceTraceTransport | null;
  up: VoiceTraceUp[];
  da?: VoiceTraceDownAudio | null;
  dv?: VoiceTraceDownVideo[];
  /** JS olay döngüsünün bu aralıktaki en yüksek gecikmesi (ms) */
  lag?: number | null;
  /** Mikrofon işlemcisinin çıkış tamponu boşalmaları (fark) */
  un?: number | null;
}

/** İşaret: yeniden bağlanma, motor olayı, tetikleme (etiketiyle) */
export interface VoiceTraceMark {
  t: number;
  /** ör. "reconnecting", "reconnected", "trigger:stun" */
  l: string;
}

/** POST /api/telemetry/voice-trace gövdesi */
export interface VoiceTraceUpload {
  v: 1;
  /** İstemcinin ürettiği kimlik: yeniden denemede aynı kalır (sunucu ikinciyi kaydetmez) */
  id: string;
  platform: ClientPlatform;
  version: string;
  channelId: string;
  /** İlk tetikleyen: loss-out, stun, bwe, freeze, blackout, conceal, reconnect, state, request, leave */
  reason: string;
  /** Kesit boyunca görülen bütün tetikleyiciler */
  reasons: string[];
  /** Sunucu isteğiyse isteğin kimliği */
  eventId: string | null;
  /** Tetikleme anı ve bu gönderim denemesinin anı (istemci saati, Unix ms) */
  triggerAt: number;
  sentAt: number;
  /** Tahmini saat farkı (sunucu − istemci, ms); ölçülemediyse null (sunucu sentAt'ten tahmin eder) */
  offsetMs: number | null;
  /** Kaçıncı deneme (1: ilk) */
  attempt: number;
  /** Sorun sürüyordu ya da kesit kısaltıldı: devamı ayrı bir gönderimle gelir */
  more: boolean;
  /** Ölçüm aralığı (ms; masaüstü 1000, telefon 2000) */
  intervalMs: number;
  samples: VoiceTraceSample[];
  marks: VoiceTraceMark[];
}

/** Sunucunun sesteki istemcilerden olay kaydı istemesi (gateway: VOICE_TRACE_REQUEST) */
export interface VoiceTraceRequest {
  channelId: string;
  eventId: string;
  reason: string;
}
