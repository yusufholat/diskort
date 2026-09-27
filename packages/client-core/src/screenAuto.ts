/**
 * Otomatik yayın kalitesi: ekran paylaşımının çözünürlüğünü, kare hızını ve bit hızı tavanını yayın sırasında
 * içeriğe ve ağa göre ayarlayan denetleyici. Platforma bağlı değildir; girdisi bağlantı istatistiklerinden
 * (bkz. connectionStats.ts) hesaplanan ölçüm, çıktısı gönderici (RTCRtpSender) ayarlarıdır. Yeniden anlaşma
 * (SDP) gerekmez: istemci `setParameters` ile uygular.
 *
 * Neden gerekli: WebRTC'nin tıkanıklık denetimi (GCC) gerçek bit hızını zaten tavanın altında tutar; tavan
 * (maxBitrate) yalnızca üst sınırdır. Bu denetleyici onun üstünde daha yavaş çalışan ikinci bir döngüdür:
 * - İçerik: hareketsiz ekranda (slayt, kod, masaüstü) netlik (yüksek çözünürlük, düşük kare hızı), oyun ve
 *   videoda akıcılık (60 FPS) seçilir. İçerik kodlayıcının kendi istatistiklerinden anlaşılır: hareketsiz ekranda
 *   kodlayıcı hedefinin çok altında veri üretir (ölçülen: NVENC/libvpx'te hedefin %3–28'i), harekette hedefi
 *   doldurur (%89–98). Ek kare yakalama/karşılaştırma maliyeti yoktur.
 * - Ağ: kayıp ve kuyruk gecikmesi (ping artışı) görülünce tavan düşürülür, ağ sakinken yavaşça yükseltilir.
 *   Böylece GCC tavana doğru yoklama yaparken ev bağlantısının yükleme kuyruğunu doldurup sesi bozmaz.
 * - İşlemci: kodlayıcı işlemci yüzünden kısıtlanıyorsa (qualityLimitationReason = cpu) bit hızı değil,
 *   çözünürlük/kare hızı basamak basamak düşürülür; uzun süre sorun olmazsa geri alınır.
 */
import type { RtpStream, TransportStats } from './connectionStats';

export type ScreenContentKind = 'motion' | 'static';

interface Profile {
  /** Üst katmanın en fazla yüksekliği (kaynak daha küçükse kaynak) */
  height: number;
  fps: number;
}

export const SCREEN_AUTO = {
  /** Bit hızı tavanının alt sınırı; ağ bunun da altındaysa GCC zaten altına iner */
  minBitrate: 1_500_000,
  /** İçeriğe göre tavanın üst sınırı (sunucu trafiği ≈ tavan × izleyici; hareketsiz ekran bunun çok altında kalır) */
  maxBitrate: { motion: 8_000_000, static: 6_000_000 } satisfies Record<ScreenContentKind, number>,
  /** Yakalama sınırı: 4K ekranlar 1440p'ye küçültülerek yakalanır */
  capture: { width: 2560, height: 1440, fps: 60 },
  /** İşlemci basamakları: 0 normal, sonrakiler işlemci kısıtlanınca */
  profiles: {
    motion: [
      { height: 1080, fps: 60 },
      { height: 720, fps: 60 },
      { height: 720, fps: 30 },
    ],
    static: [
      { height: 1440, fps: 15 },
      { height: 1440, fps: 8 },
      { height: 1080, fps: 8 },
    ],
  } satisfies Record<ScreenContentKind, Profile[]>,
  /** Kodlayıcı hedefinin bu oranını dolduran içerik hareketli, bunun altında kalan hareketsiz sayılır */
  motionUtilization: 0.7,
  staticUtilization: 0.4,
  /** Hareketsizden hareketliye: son 4 ölçümün 3'ü hareketli ve geçişten beri en az bu kadar süre */
  toMotionAfterMs: 8_000,
  /** Hareketliden hareketsize: son 5 ölçümün hepsi hareketsiz ve geçişten beri en az bu kadar süre */
  toStaticAfterMs: 10_000,
  /** Geçişten sonra bu süre oy sayılmaz: yeni çözünürlükte kodlayıcı ilk saniyelerde anahtar kare ve iyileştirme için hedefi doldurur (ölçüldü) */
  settleMs: 3_000,
  /** Kayıp (%) eşikleri: ağır kayıpta tavan %30, orta kayıpta %15 düşer */
  heavyLossPercent: 10,
  lossPercent: 3,
  /** Bu kadar kayıp altı "sakin" sayılır */
  calmLossPercent: 2,
  /** Ping en düşük değerin bu kadar üstündeyse yükleme kuyruğu doluyor demektir */
  queueDelayMs: 150,
  /** İki düşürme arasında en az (etkisi görülsün) */
  decreaseIntervalMs: 4_000,
  /** Yükseltme: ardışık bu kadar sakin ölçüm ve son düşürmeden beri en az bu kadar süre */
  calmTicksToIncrease: 3,
  increaseAfterDecreaseMs: 10_000,
  increaseFactor: 1.15,
  /** İşlemci: ardışık bu kadar kısıtlı ölçümde bir basamak düşülür; basamaklar arası en az bu kadar */
  cpuTicksToStepDown: 2,
  cpuStepIntervalMs: 10_000,
  /** Geri yükselmeden önce işlemci sorunsuz geçmesi gereken süre; her düşüşte ikiye katlanır (en çok 5 dk) */
  cpuRecoverMs: 60_000,
  cpuRecoverMaxMs: 300_000,
} as const;

const GLOBAL_MAX = Math.max(SCREEN_AUTO.maxBitrate.motion, SCREEN_AUTO.maxBitrate.static);
const MAX_CPU_LEVEL = SCREEN_AUTO.profiles.motion.length - 1;

// ---------- Ölçüm ----------

export type QualityLimitation = 'cpu' | 'bandwidth' | 'other' | 'none';

/** İki istatistik ölçümü arasında yayın görüntüsünün durumu */
export interface ScreenMeasurement {
  intervalMs: number;
  /** Üst katmanın gönderdiği / kodlayıcının hedefi (0–2); hedef bilinmiyorsa tavana göre */
  utilization: number | null;
  /** Üst katmanın kodladığı kare hızı */
  encodedFps: number;
  /** Tüm katmanların toplam bit hızı */
  bitrate: number;
  /** Tüm katmanlarda giden paket kaybı (%) */
  lossPercent: number | null;
  rttMs: number | null;
  availableOutgoingBitrate: number | null;
  limitation: QualityLimitation | null;
  /** Üst katmanın gönderilen çözünürlüğü ve kare hızı */
  width: number | null;
  height: number | null;
  implementation: string | null;
}

function limitationOf(v: string | null): QualityLimitation | null {
  return v === 'cpu' || v === 'bandwidth' || v === 'other' || v === 'none' ? v : null;
}

/**
 * Yayın bağlantısının iki ölçümünden ekran yayınının durumunu çıkarır. `trackIds` yayının MediaStreamTrack
 * kimlikleri, `topMaxBitrate` üst katmanın o anki tavanı (kodlayıcı hedefi raporlanmıyorsa oran için).
 * Yayın duraklatılmışsa (izleyen yok, dynacast kodlamayı durdurdu) ya da karşılaştırılacak önceki ölçüm yoksa
 * null döner; denetleyici o zaman durumunu korur.
 */
export function measureScreen(
  curr: TransportStats,
  prev: TransportStats | null,
  trackIds: readonly string[],
  topMaxBitrate: number,
): ScreenMeasurement | null {
  if (!prev) return null;
  const seconds = (curr.at - prev.at) / 1000;
  if (seconds <= 0) return null;
  const prevById = new Map(prev.streams.map((s) => [s.id, s]));
  const layers: { s: RtpStream; p: RtpStream }[] = [];
  for (const s of curr.streams) {
    if (s.direction !== 'out' || s.kind !== 'video' || !s.trackId || !trackIds.includes(s.trackId)) continue;
    const p = prevById.get(s.id);
    if (p) layers.push({ s, p });
  }
  if (layers.length === 0) return null;

  let bytes = 0;
  let packets = 0;
  let lost: number | null = null;
  for (const { s, p } of layers) {
    bytes += Math.max(0, s.bytes - p.bytes);
    packets += Math.max(0, s.packets - p.packets);
    if (s.packetsLost !== null && p.packetsLost !== null) lost = (lost ?? 0) + Math.max(0, s.packetsLost - p.packetsLost);
  }
  // Üst katman: en yüksek çözünürlüklü (dynacast kapattıysa etkin olanların en büyüğü)
  const top = layers.reduce((a, b) => ((b.s.frameHeight ?? 0) > (a.s.frameHeight ?? 0) ? b : a));
  const frames = top.s.framesEncoded !== null && top.p.framesEncoded !== null ? top.s.framesEncoded - top.p.framesEncoded : null;
  if (frames !== null && frames <= 0) return null;
  const topBitrate = (Math.max(0, top.s.bytes - top.p.bytes) * 8) / seconds;
  const target = top.s.targetBitrate ?? topMaxBitrate;

  return {
    intervalMs: curr.at - prev.at,
    utilization: target > 0 ? Math.min(2, topBitrate / target) : null,
    encodedFps: frames !== null ? frames / seconds : (top.s.framesPerSecond ?? 0),
    bitrate: Math.round((bytes * 8) / seconds),
    lossPercent: lost === null || packets === 0 ? null : Math.min(100, (lost / packets) * 100),
    rttMs: top.s.rttMs ?? curr.rttMs,
    availableOutgoingBitrate: curr.availableOutgoingBitrate,
    limitation: limitationOf(top.s.qualityLimitationReason),
    width: top.s.frameWidth,
    height: top.s.frameHeight,
    implementation: top.s.implementation,
  };
}

// ---------- Denetleyici ----------

export interface ScreenAutoState {
  content: ScreenContentKind;
  /** Son içerik geçişi (ya da başlangıç) */
  contentSince: number;
  /** Son ölçümlerin içerik oyu: 1 hareketli, -1 hareketsiz, 0 kararsız (en yenisi sonda, en çok 5) */
  votes: number[];
  /** Bu andan önceki ölçümler oylanmaz (geçiş sonrası geçici durum) */
  votesFrom: number;
  /** Ağın taşıyabildiği tahmini tavan (içerikten bağımsız); gerçek tavan içeriğin üst sınırıyla kırpılır */
  netCap: number;
  calmTicks: number;
  bandwidthTicks: number;
  lastDecreaseAt: number;
  /** En düşük (kuyruksuz) ping; yavaşça güncellenir */
  baseRttMs: number | null;
  /** İşlemci basamağı (0 = normal) */
  cpuLevel: number;
  cpuTicks: number;
  cpuChangedAt: number;
  lastCpuLimitedAt: number;
  cpuStepDowns: number;
  /** Son karar (hata ayıklama için) */
  lastChange: string | null;
}

export function createScreenAuto(now: number, content: ScreenContentKind = 'motion'): ScreenAutoState {
  return {
    content,
    contentSince: now,
    votes: [],
    votesFrom: now,
    netCap: SCREEN_AUTO.maxBitrate.motion,
    calmTicks: 0,
    bandwidthTicks: 0,
    lastDecreaseAt: -Infinity,
    baseRttMs: null,
    cpuLevel: 0,
    cpuTicks: 0,
    cpuChangedAt: now,
    lastCpuLimitedAt: -Infinity,
    cpuStepDowns: 0,
    lastChange: null,
  };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Üst katmanın o anki bit hızı tavanı */
export function screenAutoCeiling(state: ScreenAutoState): number {
  return Math.round(clamp(state.netCap, SCREEN_AUTO.minBitrate, SCREEN_AUTO.maxBitrate[state.content]));
}

function contentVote(utilization: number | null): number {
  if (utilization === null) return 0;
  if (utilization >= SCREEN_AUTO.motionUtilization) return 1;
  if (utilization <= SCREEN_AUTO.staticUtilization) return -1;
  return 0;
}

/** Bir sonraki içerik kararı (histerezis: geçişler ardışık ölçümlerle ve en az bekleme süresiyle) */
function nextContent(state: ScreenAutoState, now: number): ScreenContentKind {
  const dwell = now - state.contentSince;
  if (state.content === 'static') {
    const recent = state.votes.slice(-4);
    if (dwell >= SCREEN_AUTO.toMotionAfterMs && recent.filter((v) => v === 1).length >= 3) return 'motion';
  } else {
    const recent = state.votes.slice(-5);
    if (dwell >= SCREEN_AUTO.toStaticAfterMs && recent.length === 5 && recent.every((v) => v === -1)) return 'static';
  }
  return state.content;
}

const mbps = (bps: number): string => `${(bps / 1_000_000).toFixed(1).replace('.', ',')} Mbps`;

/**
 * Yeni ölçümle denetleyiciyi bir adım ilerletir (saf işlev; yeni durum döner). Ölçüm yoksa (yayın duraklatıldı)
 * durum aynen korunur.
 */
export function stepScreenAuto(state: ScreenAutoState, m: ScreenMeasurement | null, now: number): ScreenAutoState {
  if (!m) return state;
  const s: ScreenAutoState = { ...state, votes: [...state.votes] };
  const ceiling = screenAutoCeiling(state);

  // --- Ağ ---
  const queueing =
    m.rttMs !== null && s.baseRttMs !== null && m.rttMs - s.baseRttMs >= SCREEN_AUTO.queueDelayMs;
  if (m.rttMs !== null) {
    s.baseRttMs =
      s.baseRttMs === null || m.rttMs < s.baseRttMs ? m.rttMs : s.baseRttMs + (m.rttMs - s.baseRttMs) * 0.02;
  }
  const loss = m.lossPercent ?? 0;
  const canDecrease = now - s.lastDecreaseAt >= SCREEN_AUTO.decreaseIntervalMs;
  // Bant yetmiyor: kodlayıcı ağ yüzünden kısıtlı, uygulama hedefi dolduruyor ve tahmin tavanın epey altında
  const bandwidthShort =
    m.limitation === 'bandwidth' &&
    m.availableOutgoingBitrate !== null &&
    m.availableOutgoingBitrate * 1.2 < ceiling * 0.95 &&
    (m.utilization ?? 0) >= 0.6;
  s.bandwidthTicks = bandwidthShort ? s.bandwidthTicks + 1 : 0;

  const decrease = (to: number, why: string): void => {
    const next = Math.max(SCREEN_AUTO.minBitrate, Math.round(to));
    if (next >= ceiling) return;
    s.netCap = next;
    s.lastDecreaseAt = now;
    s.calmTicks = 0;
    s.lastChange = `${why} → tavan ${mbps(next)}`;
  };

  if (loss >= SCREEN_AUTO.heavyLossPercent && canDecrease) {
    decrease(ceiling * 0.7, `ağır paket kaybı (%${Math.round(loss)})`);
  } else if ((loss >= SCREEN_AUTO.lossPercent || queueing) && canDecrease) {
    decrease(ceiling * 0.85, queueing ? `ping yükseldi (${m.rttMs} ms)` : `paket kaybı (%${Math.round(loss)})`);
  } else if (s.bandwidthTicks >= 2 && canDecrease) {
    // GCC'nin tahmininin biraz üstü: tahmin büyüyebilsin diye pay bırakılır
    decrease(Math.max(m.availableOutgoingBitrate! * 1.2, ceiling * 0.7), 'yükleme hızı yetmiyor');
    s.bandwidthTicks = 0;
  } else if (loss < SCREEN_AUTO.calmLossPercent && !queueing && m.limitation !== 'bandwidth') {
    s.calmTicks++;
    if (
      s.calmTicks >= SCREEN_AUTO.calmTicksToIncrease &&
      now - s.lastDecreaseAt >= SCREEN_AUTO.increaseAfterDecreaseMs &&
      s.netCap < GLOBAL_MAX
    ) {
      s.netCap = Math.min(GLOBAL_MAX, Math.round(Math.max(s.netCap, ceiling) * SCREEN_AUTO.increaseFactor));
      s.calmTicks = 0;
      if (screenAutoCeiling(s) > ceiling) s.lastChange = `ağ sakin → tavan ${mbps(screenAutoCeiling(s))}`;
    }
  } else {
    s.calmTicks = 0;
  }

  // --- İşlemci ---
  if (m.limitation === 'cpu') {
    s.cpuTicks++;
    s.lastCpuLimitedAt = now;
    if (
      s.cpuTicks >= SCREEN_AUTO.cpuTicksToStepDown &&
      s.cpuLevel < MAX_CPU_LEVEL &&
      now - s.cpuChangedAt >= SCREEN_AUTO.cpuStepIntervalMs
    ) {
      s.cpuLevel++;
      s.cpuStepDowns++;
      s.cpuChangedAt = now;
      s.cpuTicks = 0;
      s.lastChange = 'işlemci yetmiyor → çözünürlük/kare hızı düşürüldü';
    }
  } else {
    s.cpuTicks = 0;
    const recoverMs = Math.min(
      SCREEN_AUTO.cpuRecoverMaxMs,
      SCREEN_AUTO.cpuRecoverMs * 2 ** Math.max(0, s.cpuStepDowns - 1),
    );
    if (s.cpuLevel > 0 && now - Math.max(s.cpuChangedAt, s.lastCpuLimitedAt) >= recoverMs) {
      s.cpuLevel--;
      s.cpuChangedAt = now;
      s.lastChange = 'işlemci rahatladı → kalite geri yükseltildi';
    }
  }

  // --- İçerik ---
  if (now >= s.votesFrom) s.votes.push(contentVote(m.utilization));
  if (s.votes.length > 5) s.votes.splice(0, s.votes.length - 5);
  const content = nextContent(s, now);
  if (content !== s.content) {
    s.content = content;
    s.contentSince = now;
    s.votes = [];
    s.votesFrom = now + SCREEN_AUTO.settleMs;
    s.cpuTicks = 0;
    s.lastChange = content === 'motion' ? 'hareket algılandı → akıcılık öncelikli' : 'içerik durağan → netlik öncelikli';
  }
  return s;
}

// ---------- Gönderici ayarları ----------

export interface ScreenEncodingPlan {
  contentHint: 'motion' | 'detail';
  degradationPreference: 'maintain-framerate' | 'maintain-resolution';
  /** Kodlamanın (tek katman) ayarları */
  scaleResolutionDownBy: number;
  maxFramerate: number;
  maxBitrate: number;
  /** Kodlanan görüntünün hedef boyutu ve kare hızı (gösterim için) */
  width: number;
  height: number;
  fps: number;
  ceiling: number;
}

/**
 * Kaynağı en çok `targetHeight` yüksekliğe indiren ölçek; iki kenar da çift sayı çıkacak şekilde seçilir.
 * WebRTC katman boyutunu kaynak / ölçek olarak aşağı yuvarlar; tek sayılı bir kenar (ör. 1280×720 → 853×480)
 * ekran kartının H.264 kodlayıcısını (Media Foundation) açılamaz yapıyor ve Chromium işlemcide kodlamaya
 * (OpenH264) düşüyor (Electron 44 + NVIDIA ile ölçüldü). Kaynak zaten küçükse 1 (büyütülmez).
 */
export function evenScale(sourceWidth: number, sourceHeight: number, targetHeight: number): number {
  const w = Math.max(1, sourceWidth);
  const h = Math.max(1, sourceHeight);
  if (h <= targetHeight) return 1;
  const first = targetHeight - (targetHeight % 2);
  // Kayan nokta hatası tabanı bir aşağı indirmesin diye hedefin çeyrek piksel üstü
  for (let target = first; target >= Math.max(2, first - 64); target -= 2) {
    const scale = h / (target + 0.25);
    if (Math.floor(w / scale) % 2 === 0 && Math.floor(h / scale) === target) return scale;
  }
  return h / (first + 0.25);
}

/** Denetleyici durumunu, yakalanan görüntünün boyutuna göre gönderici ayarlarına çevirir. */
export function planScreenEncoding(
  state: ScreenAutoState,
  source: { width: number; height: number },
): ScreenEncodingPlan {
  const profiles = SCREEN_AUTO.profiles[state.content];
  const profile = profiles[Math.min(state.cpuLevel, profiles.length - 1)]!;
  const scale = evenScale(source.width, source.height, profile.height);
  const ceiling = screenAutoCeiling(state);
  return {
    contentHint: state.content === 'motion' ? 'motion' : 'detail',
    degradationPreference: state.content === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
    scaleResolutionDownBy: scale,
    maxFramerate: profile.fps,
    maxBitrate: ceiling,
    width: Math.floor(source.width / scale),
    height: Math.floor(source.height / scale),
    fps: profile.fps,
    ceiling,
  };
}

/** "Otomatik — hareketli içerik, 1080p60, 8,0 Mbps tavan" (+ ağ/işlemci kısıtı) */
export function describeScreenAuto(state: ScreenAutoState, plan: ScreenEncodingPlan): string {
  const what = state.content === 'motion' ? 'hareketli içerik' : 'durağan içerik';
  const extra: string[] = [];
  if (plan.ceiling < SCREEN_AUTO.maxBitrate[state.content]) extra.push('ağ sınırlı');
  if (state.cpuLevel > 0) extra.push('işlemci sınırlı');
  return `Otomatik — ${what}, ${plan.height}p${plan.fps}, ${mbps(plan.ceiling)} tavan${extra.length ? ` (${extra.join(', ')})` : ''}`;
}
