// Hat testi: hız profilleri ve saniye saniye gönderim planı. Plan yalnızca sunucuda üretilir; istemci (araç ve
// uygulama) planı oturum yanıtından alıp olduğu gibi uygular, böylece yeni profiller eski istemcilerle de çalışır.

export type LineProfile = 'ramp' | 'pps' | 'steady' | 'quick';
export type LineMode = 'up' | 'down' | 'both';
export type LineTransport = 'udp' | 'tcp';

export const LINE_PROFILES: readonly LineProfile[] = ['ramp', 'pps', 'steady', 'quick'];
export const LINE_MODES: readonly LineMode[] = ['up', 'down', 'both'];

/** Planın bir saniyesi: o saniyede gönderilecek paket sayısı ve boyutu */
export interface PlanSecond {
  step: number;
  /** UDP yük boyutu (bayt; başlık dahil) */
  size: number;
  pps: number;
  /** Saniyede kaç topluluk (video karesi gibi); 0: saniyeye eşit yayılır */
  fps: number;
}

export interface PlanStep {
  step: number;
  label: string;
  /** Hedef UDP yük hızı (bit/sn) */
  rateBps: number;
  size: number;
  pps: number;
  fps: number;
  secs: number;
  startSec: number;
}

export interface LinePlan {
  profile: LineProfile;
  mode: LineMode;
  seconds: PlanSecond[];
  steps: PlanStep[];
  /** Saniye başına toplam paket ve toplam süre */
  totalPackets: number;
  durationMs: number;
  /** Bir yönde ulaşılan en yüksek hız (bit/sn) */
  peakBps: number;
}

/** Bir oturumun en uzun süresi (sn) */
export const MAX_PLAN_SECONDS = 60;
export const MIN_PACKET = 100;
export const MAX_PACKET = 1300;
/** Tek yönde en yüksek hız (bit/sn) ve iki yönlü (both) testte yön başına tavan */
export const MAX_RATE_BPS = 12_000_000;
export const MAX_BOTH_RATE_BPS = 8_000_000;
/** En yüksek paket/sn */
export const MAX_PPS = 6_000;

const MBPS = 1_000_000;

interface StepSpec {
  label: string;
  rateBps?: number;
  pps?: number;
  size: number;
  fps?: number;
  secs: number;
}

function specs(profile: LineProfile, mode: LineMode): StepSpec[] {
  const both = mode === 'both';
  if (profile === 'pps') {
    return [250, 500, 1000, 2000, 4000, 6000].map((pps) => ({ label: `${pps} pk/sn`, pps, size: 200, secs: 4 }));
  }
  if (profile === 'steady') {
    return [{ label: 'yayın benzeri 8 Mbps', rateBps: 8 * MBPS, size: 1200, fps: 30, secs: 30 }];
  }
  const rates = profile === 'quick' ? [1, 2, 4, 6, 8] : [0.5, 1, 2, 4, 6, 8, 10, 12];
  return rates
    .filter((r) => r * MBPS <= (both ? MAX_BOTH_RATE_BPS : MAX_RATE_BPS))
    .map((r) => ({ label: `${r} Mbps`, rateBps: r * MBPS, size: 1200, secs: profile === 'quick' ? 2 : 4 }));
}

export function buildPlan(profile: LineProfile, mode: LineMode): LinePlan {
  const seconds: PlanSecond[] = [];
  const steps: PlanStep[] = [];
  let peak = 0;
  for (const spec of specs(profile, mode)) {
    const size = Math.min(MAX_PACKET, Math.max(MIN_PACKET, spec.size));
    const pps = Math.min(MAX_PPS, spec.pps ?? Math.max(1, Math.round((spec.rateBps ?? 0) / (size * 8))));
    const fps = spec.fps ?? 0;
    const rateBps = pps * size * 8;
    peak = Math.max(peak, rateBps);
    steps.push({ step: steps.length, label: spec.label, rateBps, size, pps, fps, secs: spec.secs, startSec: seconds.length });
    for (let i = 0; i < spec.secs; i++) seconds.push({ step: steps.length - 1, size, pps, fps });
  }
  if (seconds.length > MAX_PLAN_SECONDS) throw new Error('Plan çok uzun.');
  return {
    profile,
    mode,
    seconds,
    steps,
    totalPackets: seconds.reduce((n, s) => n + s.pps, 0),
    durationMs: seconds.length * 1000,
    peakBps: peak,
  };
}

/** Her saniyenin ilk paketinin sıra numarası (+ sonda toplam) */
export function cumulative(seconds: readonly PlanSecond[]): number[] {
  const out: number[] = [0];
  for (const s of seconds) out.push((out[out.length - 1] ?? 0) + s.pps);
  return out;
}

/** t ms'ye kadar (t dahil) gönderilmiş olması gereken paket sayısı; istemci ve sunucu aynı formülü kullanır */
export function dueCount(seconds: readonly PlanSecond[], cum: readonly number[], tMs: number): number {
  if (tMs < 0) return 0;
  const s = Math.floor(tMs / 1000);
  if (s >= seconds.length) return cum[seconds.length] ?? 0;
  const p = seconds[s]!;
  const frac = (tMs - s * 1000) / 1000;
  let n: number;
  if (p.fps > 0) {
    const bursts = Math.min(p.fps, Math.floor(frac * p.fps) + 1);
    n = Math.ceil((p.pps * bursts) / p.fps);
  } else {
    n = Math.floor(p.pps * frac);
  }
  return (cum[s] ?? 0) + Math.min(p.pps, n);
}

/** Planın sıra numarasından saniyesini bulan arama tablosu */
export function secondOfSeqTable(seconds: readonly PlanSecond[]): Uint16Array {
  const total = seconds.reduce((n, s) => n + s.pps, 0);
  const table = new Uint16Array(total);
  let i = 0;
  seconds.forEach((s, sec) => {
    for (let k = 0; k < s.pps; k++) table[i++] = sec;
  });
  return table;
}

/** Bir testin ayırdığı bant genişliği (bit/sn, yön sayısıyla): sunucunun toplam sınırına sayılır */
export function reservedBps(plan: LinePlan): number {
  return plan.peakBps * (plan.mode === 'both' ? 2 : 1);
}
