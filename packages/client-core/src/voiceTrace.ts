import {
  VOICE_TRACE_MAX_MARKS,
  VOICE_TRACE_MAX_SAMPLES,
  VOICE_TRACE_MIN_GAP_MS,
  VOICE_TRACE_POST_MS,
  VOICE_TRACE_PRE_MS,
  VOICE_TRACE_REQUEST_GAP_MS,
  VOICE_TRACE_RING_MS,
  type VoiceTraceDownAudio,
  type VoiceTraceDownVideo,
  type VoiceTraceMark,
  type VoiceTraceSample,
  type VoiceTraceTransport,
  type VoiceTraceUp,
  type VoiceTraceUplinkKind,
} from '@diskort/shared';
import { statList, type RtcStat, type StatsSource } from './connectionStats';

/**
 * Olay kaydı (bkz. shared/voiceTrace.ts): getStats() raporlarından saniyelik, kısa anahtarlı kayıtlar üretir,
 * ~120 sn'lik halka tamponda tutar ve bir sorun tetiklenince gönderilecek kesiti çıkarır. Platforma ve ağa
 * bağlı değildir (rapor platformda alınır, kesit `onCapture` ile verilir; gönderim voiceTraceUpload.ts'te):
 * zaman dışarıdan verilir, zamanlayıcı kullanılmaz; her şey ölçüm geldikçe ilerler.
 *
 * 30 sn'lik özetin (voiceTelemetry.ts) hesabından bağımsızdır: kendi sayaç farklarını tutar, özetin
 * ölçümlerine dokunmaz.
 */

// ---------- Raporun okunması (toplam sayaçlar) ----------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const ms = (seconds: unknown): number | null => {
  const s = num(seconds);
  return s === null ? null : Math.round(s * 1000);
};

/** Seçili aday çiftinin o anki toplamları (adres yok) */
export interface TracePair {
  id: string;
  rttMs: number | null;
  requestsSent: number | null;
  responsesReceived: number | null;
  availableOutgoingBitrate: number | null;
  availableIncomingBitrate: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  packetsDiscardedOnSend: number | null;
  candidateType: string | null;
  protocol: string | null;
}

/** Giden akışın (outbound-rtp + karşı tarafın remote-inbound-rtp raporu) toplamları */
export interface TraceOut {
  id: string;
  video: boolean;
  trackId: string | null;
  packetsSent: number;
  bytesSent: number;
  packetsLost: number | null;
  fractionLost: number | null;
  /** Son alıcı raporunun geliş anı (remote-inbound-rtp.timestamp); bildirilmiyorsa null */
  reportAt: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  targetBitrate: number | null;
  framesEncoded: number | null;
  framesSent: number | null;
  keyFramesEncoded: number | null;
  hugeFramesSent: number | null;
  nackCount: number | null;
  pliCount: number | null;
  firCount: number | null;
  retransmittedBytesSent: number | null;
  retransmittedPacketsSent: number | null;
  totalPacketSendDelay: number | null;
  totalEncodeTime: number | null;
  qualityLimitationReason: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
}

/** Gelen akışın (inbound-rtp) toplamları */
export interface TraceIn {
  id: string;
  video: boolean;
  packetsReceived: number;
  bytesReceived: number;
  packetsLost: number | null;
  packetsDiscarded: number | null;
  jitterMs: number | null;
  framesDecoded: number | null;
  keyFramesDecoded: number | null;
  freezeCount: number | null;
  totalFreezesDuration: number | null;
  framesDropped: number | null;
  nackCount: number | null;
  pliCount: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  concealedSamples: number | null;
  silentConcealedSamples: number | null;
  concealmentEvents: number | null;
  totalSamplesReceived: number | null;
}

export interface TraceTotals {
  pair: TracePair | null;
  out: TraceOut[];
  in: TraceIn[];
}

function selectedPair(stats: RtcStat[], byId: Map<string, RtcStat>): RtcStat | undefined {
  for (const s of stats) {
    if (s.type !== 'transport') continue;
    const pair = byId.get(str(s.selectedCandidatePairId) ?? '');
    if (pair) return pair;
  }
  const pairs = stats.filter((s) => s.type === 'candidate-pair');
  return (
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded') ??
    pairs.find((p) => p.nominated === true && num(p.currentRoundTripTime) !== null)
  );
}

const isVideo = (s: RtcStat): boolean => (s.kind ?? s.mediaType) === 'video';

/**
 * Bağlantıların getStats() raporlarından olay kaydının sayaçlarını okur. Birden çok rapor (yayın + abonelik
 * bağlantısı) verilebilir: aday çifti, çifti olan ilk rapordan; akışlar hepsinden alınır (kimlikler rapor
 * sırasıyla ayrışır). Tek bağlantı kipinde tek rapor yeter.
 */
export function parseTraceTotals(reports: readonly StatsSource[]): TraceTotals {
  const totals: TraceTotals = { pair: null, out: [], in: [] };
  reports.forEach((report, index) => {
    const stats = statList(report);
    if (stats.length === 0) return;
    const byId = new Map(stats.map((s) => [s.id, s]));
    const prefix = index === 0 ? '' : `${index}:`;
    if (!totals.pair) {
      const pair = selectedPair(stats, byId);
      if (pair) {
        const transport = stats.find((s) => s.type === 'transport');
        const local = byId.get(str(pair.localCandidateId) ?? '');
        const type = local ? str(local.candidateType) : null;
        totals.pair = {
          id: prefix + pair.id,
          rttMs: ms(pair.currentRoundTripTime),
          requestsSent: num(pair.requestsSent),
          responsesReceived: num(pair.responsesReceived),
          availableOutgoingBitrate: num(pair.availableOutgoingBitrate),
          availableIncomingBitrate: num(pair.availableIncomingBitrate),
          bytesSent: num(transport?.bytesSent) ?? num(pair.bytesSent),
          bytesReceived: num(transport?.bytesReceived) ?? num(pair.bytesReceived),
          packetsDiscardedOnSend: num(pair.packetsDiscardedOnSend),
          candidateType: type,
          protocol: local ? ((type === 'relay' ? str(local.relayProtocol) : null) ?? str(local.protocol)) : null,
        };
      }
    }
    const remoteInbound = new Map<string, RtcStat>();
    for (const s of stats) {
      if (s.type === 'remote-inbound-rtp' && str(s.localId)) remoteInbound.set(s.localId as string, s);
    }
    for (const s of stats) {
      if (s.type === 'outbound-rtp') {
        if (s.active === false) continue;
        const remote = remoteInbound.get(s.id) ?? stats.find((r) => r.type === 'remote-inbound-rtp' && r.ssrc === s.ssrc);
        const source = byId.get(str(s.mediaSourceId) ?? '');
        const fraction = remote ? num(remote.fractionLost) : null;
        totals.out.push({
          id: prefix + s.id,
          video: isVideo(s),
          trackId: source ? str(source.trackIdentifier) : null,
          packetsSent: num(s.packetsSent) ?? 0,
          bytesSent: num(s.bytesSent) ?? 0,
          packetsLost: remote ? num(remote.packetsLost) : null,
          fractionLost: fraction === null ? null : Math.min(100, Math.max(0, fraction * 100)),
          reportAt: remote ? num(remote.timestamp) : null,
          rttMs: remote ? ms(remote.roundTripTime) : null,
          jitterMs: remote ? ms(remote.jitter) : null,
          targetBitrate: num(s.targetBitrate),
          framesEncoded: num(s.framesEncoded),
          framesSent: num(s.framesSent),
          keyFramesEncoded: num(s.keyFramesEncoded),
          hugeFramesSent: num(s.hugeFramesSent),
          nackCount: num(s.nackCount),
          pliCount: num(s.pliCount),
          firCount: num(s.firCount),
          retransmittedBytesSent: num(s.retransmittedBytesSent),
          retransmittedPacketsSent: num(s.retransmittedPacketsSent),
          totalPacketSendDelay: num(s.totalPacketSendDelay),
          totalEncodeTime: num(s.totalEncodeTime),
          qualityLimitationReason: str(s.qualityLimitationReason),
          frameWidth: num(s.frameWidth),
          frameHeight: num(s.frameHeight),
          framesPerSecond: num(s.framesPerSecond),
        });
      } else if (s.type === 'inbound-rtp') {
        totals.in.push({
          id: prefix + s.id,
          video: isVideo(s),
          packetsReceived: num(s.packetsReceived) ?? 0,
          bytesReceived: num(s.bytesReceived) ?? 0,
          packetsLost: num(s.packetsLost),
          packetsDiscarded: num(s.packetsDiscarded),
          jitterMs: ms(s.jitter),
          framesDecoded: num(s.framesDecoded),
          keyFramesDecoded: num(s.keyFramesDecoded),
          freezeCount: num(s.freezeCount),
          totalFreezesDuration: num(s.totalFreezesDuration),
          framesDropped: num(s.framesDropped),
          nackCount: num(s.nackCount),
          pliCount: num(s.pliCount),
          jitterBufferDelay: num(s.jitterBufferDelay),
          jitterBufferEmittedCount: num(s.jitterBufferEmittedCount),
          framesPerSecond: num(s.framesPerSecond),
          frameWidth: num(s.frameWidth),
          frameHeight: num(s.frameHeight),
          concealedSamples: num(s.concealedSamples),
          silentConcealedSamples: num(s.silentConcealedSamples),
          concealmentEvents: num(s.concealmentEvents),
          totalSamplesReceived: num(s.totalSamplesReceived),
        });
      }
    }
  });
  return totals;
}

// ---------- İki ölçüm arasındaki farklar ----------

/** Sayaç farkı; iki ölçümden birinde yoksa null, sayaç geriye gittiyse (yeni akış) 0 */
const diff = (curr: number | null | undefined, prev: number | null | undefined): number | null =>
  curr === null || curr === undefined || prev === null || prev === undefined ? null : Math.max(0, curr - prev);

/** null'lar toplanmaz; hepsi null ise null */
const addN = (a: number | null, b: number | null): number | null => (b === null ? a : (a ?? 0) + b);
const maxN = (a: number | null, b: number | null): number | null => (b === null ? a : a === null ? b : Math.max(a, b));
const round1 = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

const LIMITATIONS = new Set(['none', 'cpu', 'bandwidth']);

/**
 * Giden akışların tür başına farkları. Önceki ölçümde olmayan akış (yeni yayın, yeniden yayınlanan akış)
 * bu ölçümde sayılmaz: sayaçları baştan beri toplam olurdu.
 */
export function uplinkDeltas(
  curr: readonly TraceOut[],
  prev: ReadonlyMap<string, TraceOut>,
  kinds: Readonly<Record<string, VoiceTraceUplinkKind>> = {},
): VoiceTraceUp[] {
  const byKind = new Map<VoiceTraceUplinkKind, VoiceTraceUp & { encodeSec: number | null; area: number }>();
  for (const s of curr) {
    const p = prev.get(s.id);
    if (!p) continue;
    const kind = (s.trackId ? kinds[s.trackId] : undefined) ?? (s.video ? 'v' : 'a');
    let u = byKind.get(kind);
    if (!u) {
      u = { k: kind, ps: 0, bs: 0, encodeSec: null, area: -1 };
      byKind.set(kind, u);
    }
    u.ps += diff(s.packetsSent, p.packetsSent) ?? 0;
    u.bs += diff(s.bytesSent, p.bytesSent) ?? 0;
    u.pl = addN(u.pl ?? null, diff(s.packetsLost, p.packetsLost));
    u.fl = maxN(u.fl ?? null, round1(s.fractionLost));
    // Yeni alıcı raporu geldi mi (geliş anı değiştiyse); an bildirilmiyorsa alan eklenmez
    if (s.reportAt !== null && p.reportAt !== null) u.rr = (u.rr ?? 0) + (s.reportAt !== p.reportAt ? 1 : 0);
    u.rtt = maxN(u.rtt ?? null, s.rttMs);
    u.jt = maxN(u.jt ?? null, s.jitterMs);
    if (!s.video) continue;
    u.tb = addN(u.tb ?? null, s.targetBitrate === null ? null : Math.round(s.targetBitrate));
    u.fe = addN(u.fe ?? null, diff(s.framesEncoded, p.framesEncoded));
    u.fs = addN(u.fs ?? null, diff(s.framesSent, p.framesSent));
    u.kf = addN(u.kf ?? null, diff(s.keyFramesEncoded, p.keyFramesEncoded));
    u.hf = addN(u.hf ?? null, diff(s.hugeFramesSent, p.hugeFramesSent));
    u.nk = addN(u.nk ?? null, diff(s.nackCount, p.nackCount));
    u.pli = addN(u.pli ?? null, diff(s.pliCount, p.pliCount));
    u.fir = addN(u.fir ?? null, diff(s.firCount, p.firCount));
    u.rb = addN(u.rb ?? null, diff(s.retransmittedBytesSent, p.retransmittedBytesSent));
    u.rp = addN(u.rp ?? null, diff(s.retransmittedPacketsSent, p.retransmittedPacketsSent));
    const delay = diff(s.totalPacketSendDelay, p.totalPacketSendDelay);
    u.sd = addN(u.sd ?? null, delay === null ? null : Math.round(delay * 1000));
    u.encodeSec = addN(u.encodeSec, diff(s.totalEncodeTime, p.totalEncodeTime));
    // Kısıtlama: katmanlardan biri kısıtlıysa o (none dışındaki öne geçer)
    const reason = s.qualityLimitationReason;
    if (reason && (u.ql === undefined || u.ql === null || u.ql === 'none')) u.ql = LIMITATIONS.has(reason) ? reason : 'other';
    // Boyut ve kare hızı: en büyük katmandan
    const area = (s.frameWidth ?? 0) * (s.frameHeight ?? 0);
    if (area > u.area) {
      u.area = area;
      u.w = s.frameWidth;
      u.h = s.frameHeight;
      u.fps = round1(s.framesPerSecond);
    }
  }
  return [...byKind.values()].map(({ encodeSec, area: _area, ...u }) => {
    if (encodeSec !== null && u.fe) u.em = round1((encodeSec / u.fe) * 1000);
    return u;
  });
}

/** Tek ölçümde en fazla bu kadar gelen görüntü akışı kaydedilir (en çok bayt alanlar) */
const MAX_DOWN_VIDEO = 3;

/** Gelen akışların farkları: sesler toplanır, görüntü akışları (veri gelenler) ayrı ayrı */
export function downlinkDeltas(
  curr: readonly TraceIn[],
  prev: ReadonlyMap<string, TraceIn>,
  indexOf: (id: string) => number,
): { da: VoiceTraceDownAudio | null; dv: VoiceTraceDownVideo[]; ids: string[] } {
  let da: VoiceTraceDownAudio | null = null;
  const videos: { id: string; v: VoiceTraceDownVideo }[] = [];
  for (const s of curr) {
    const p = prev.get(s.id);
    if (!p) continue;
    const pr = diff(s.packetsReceived, p.packetsReceived) ?? 0;
    const pl = diff(s.packetsLost, p.packetsLost);
    const bs = diff(s.bytesReceived, p.bytesReceived) ?? 0;
    if (!s.video) {
      da ??= { n: 0, pr: 0, pl: 0, bs: 0, j: null, ss: null, cs: null, ce: null };
      // Susturulmuş (paket gelmeyen) akışın titreşimi eskidir: sayılmaz
      if (pr + (pl ?? 0) === 0) continue;
      da.n++;
      da.pr += pr;
      da.pl += pl ?? 0;
      da.bs += bs;
      da.j = maxN(da.j, s.jitterMs);
      const samples = diff(s.totalSamplesReceived, p.totalSamplesReceived);
      const concealed = diff(s.concealedSamples, p.concealedSamples);
      // Sessizlikte (DTX) sentezlenen örnekler duyulmaz; tarayıcı hiç bildirmiyorsa 0
      const silent =
        s.silentConcealedSamples === null && p.silentConcealedSamples === null
          ? 0
          : diff(s.silentConcealedSamples, p.silentConcealedSamples);
      if (samples !== null && concealed !== null && silent !== null) {
        da.ss = (da.ss ?? 0) + samples;
        da.cs = (da.cs ?? 0) + Math.max(0, concealed - silent);
      }
      da.ce = addN(da.ce, diff(s.concealmentEvents, p.concealmentEvents));
      continue;
    }
    const fd = diff(s.framesDecoded, p.framesDecoded);
    // Duraklatılmış (izlenmeyen, veri gelmeyen) görüntü akışı kaydı şişirmesin; donan akış (paket ya da
    // kayıp var, kare yok) ise kalır
    if (pr === 0 && (pl ?? 0) === 0 && (fd ?? 0) === 0) continue;
    const freezeSec = diff(s.totalFreezesDuration, p.totalFreezesDuration);
    const emitted = diff(s.jitterBufferEmittedCount, p.jitterBufferEmittedCount);
    const delay = diff(s.jitterBufferDelay, p.jitterBufferDelay);
    videos.push({
      id: s.id,
      v: {
        i: indexOf(s.id),
        pr,
        pl,
        bs,
        j: s.jitterMs,
        fd,
        kf: diff(s.keyFramesDecoded, p.keyFramesDecoded),
        fz: diff(s.freezeCount, p.freezeCount),
        fzd: freezeSec === null ? null : Math.round(freezeSec * 1000),
        dr: diff(s.framesDropped, p.framesDropped),
        pdc: diff(s.packetsDiscarded, p.packetsDiscarded),
        nk: diff(s.nackCount, p.nackCount),
        pli: diff(s.pliCount, p.pliCount),
        jb: emitted && delay !== null ? round1((delay / emitted) * 1000) : null,
        fps: round1(s.framesPerSecond),
        w: s.frameWidth,
        h: s.frameHeight,
      },
    });
  }
  videos.sort((a, b) => b.v.bs - a.v.bs);
  const kept = videos.slice(0, MAX_DOWN_VIDEO);
  return { da, dv: kept.map((x) => x.v), ids: kept.map((x) => x.id) };
}

// ---------- Tetikleyiciler ----------

/**
 * Giden kayıp: kayıp, alıcı raporları (RR) arasında gönderilen paketlere oranlanır (rapor her ölçümde gelmez).
 * Bir rapor aralığı "kötü" sayılır: en az bu oranda (%) ve bu kadar paket kayıp, ve aralıkta en az
 * TRACE_LOSS_MIN_SENT paket gönderilmiş (susan DTX mikrofonu saniyede 2-3 paket gönderir: birkaç paketin
 * kaybı büyük yüzde verir, sayılmaz). Art arda iki kötü rapor aralığı (farklı ölçümlerde) tetikler.
 */
export const TRACE_LOSS_PCT = 5;
const TRACE_LOSS_MIN_PACKETS = 2;
const TRACE_LOSS_MIN_SENT = 20;
/** Paydada en çok bu kadar sürenin paketleri birikir (rapor uzun süre gelmezse eski paketler oranı sulandırmasın) */
const TRACE_LOSS_ACCUM_MS = 6_000;
/** İki kötü rapor aralığı arasında en çok bu kadar süre olabilir (seyrek raporlar: ~5 sn'de bir) */
const TRACE_LOSS_RUN_GAP_MS = 6_500;
/**
 * Koşulun "sürdü" sayılması: art arda EN AZ İKİ ölçüm ve toplam bu kadar süre (masaüstünde 2 × 1 sn, telefonda
 * 2 × 2 sn). Tek ölçüm, aralığı ne kadar uzun olursa olsun yetmez.
 */
const TRACE_HOLD_MS = 1_900;
const TRACE_HOLD_SAMPLES = 2;
/** STUN bu kadar süre yanıtsızsa tetiklenir; arayüzde ping bu kadar süre yanıtsızsa "eski" görünür */
export const TRACE_STUN_UNANSWERED_MS = 2_000;
export const PING_STALE_MS = 3_000;
/** Bant genişliği tahmini, son 10 sn'nin ortancasının bu oranının altına düşerse (yayındayken) */
const TRACE_BWE_DROP = 0.5;
const TRACE_BWE_WINDOW_MS = 10_000;
const TRACE_BWE_MIN_SAMPLES = 5;
/** Donma: bildirilen donma en az bu kadar sürdüyse ya da paket gelirken bir ölçüm boyunca kare çözülmediyse */
const TRACE_FREEZE_MIN_MS = 500;
const TRACE_STALL_MIN_PACKETS = 5;
const TRACE_FULL_SAMPLE_MS = 900;
/**
 * "Gelen akış kesildi": öncesinde en az bu kadar veri (bayt/sn) ve kısa süre önce gelen ortam paketi varken
 * hiç bayt gelmiyor VE yanıtlanmamış STUN isteği var. Oda sessizleşince (herkes sustu) STUN yanıtları
 * gelmeye devam eder; yanıtlar arasındaki sıfır baytlı ölçümler kesinti değildir.
 */
const TRACE_BLACKOUT_MIN_RATE = 2_000;
const TRACE_BLACKOUT_RECENT_MEDIA_MS = 5_000;
/** Bayt gelmeyen her ölçümde hız tahmini bu oranla söner */
const TRACE_IN_RATE_DECAY = 0.7;
/** Gelen seste gizlenen örnek oranı (sessizlik hariç) */
const TRACE_CONCEAL_RATIO = 0.2;
/** Bu kadar kısa aralıkla gelen ölçüm (ör. panel açılınca anında alınan) kaydedilmez */
const MIN_SAMPLE_GAP_MS = 300;
/** Ölçümler arasında bu kadar boşluk (uyku, arka plan) farkları anlamsızlaştırır: sayaçlar yeniden başlar */
const MAX_SAMPLE_GAP_MS = 15_000;

export type TraceReason =
  | 'loss-out'
  | 'stun'
  | 'bwe'
  | 'freeze'
  | 'blackout'
  | 'conceal'
  | 'reconnect'
  | 'state'
  | 'request'
  | 'leave';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Koşul art arda en az TRACE_HOLD_SAMPLES ölçümde ve TRACE_HOLD_MS boyunca sürdü mü */
class Hold {
  private heldMs = 0;
  private samples = 0;
  feed(active: boolean, dt: number): boolean {
    this.heldMs = active ? this.heldMs + dt : 0;
    this.samples = active ? this.samples + 1 : 0;
    return this.samples >= TRACE_HOLD_SAMPLES && this.heldMs >= TRACE_HOLD_MS;
  }
  reset(): void {
    this.heldMs = 0;
    this.samples = 0;
  }
}

/** Bir giden akış türünün kayıp durumu: son rapordan beri biriken paketler ve art arda kötü rapor aralıkları */
interface LossRun {
  /** Son alıcı raporundan beri gönderilen / kayıp bildirilen paket ve birikimin başladığı an */
  sent: number;
  lost: number;
  since: number;
  /** Art arda kötü rapor aralığı sayısı ve sonuncusunun anı */
  bad: number;
  lastBadAt: number;
}

// ---------- Kayıt ----------

export interface TraceSampleInput {
  /** İstemci saati (Unix ms) */
  at: number;
  /** Bağlantıların getStats() raporları (yayın bağlantısı ilk sırada) */
  reports: readonly StatsSource[];
  /** MediaStreamTrack kimliği → giden akışın türü (mikrofon, ekran, yayın sesi) */
  kinds?: Readonly<Record<string, VoiceTraceUplinkKind>>;
  ice?: string | null;
  pc?: string | null;
  /** LiveKit'in bildirdiği bağlantı kalitesi */
  lk?: string | null;
  /** JS olay döngüsünün son ölçümden beri en yüksek gecikmesi (ms) */
  lagMs?: number | null;
  /** Mikrofon işlemcisinin çıkış tamponu boşalmaları (toplam sayaç) */
  micUnderruns?: number | null;
}

/** Gönderilecek kesit (gönderim bilgileri voiceTraceUpload.ts'te eklenir) */
export interface TraceCapture {
  id: string;
  channelId: string;
  reason: TraceReason;
  reasons: TraceReason[];
  eventId: string | null;
  triggerAt: number;
  more: boolean;
  intervalMs: number;
  samples: VoiceTraceSample[];
  marks: VoiceTraceMark[];
}

interface PendingCapture {
  reason: TraceReason;
  reasons: Set<TraceReason>;
  triggerAt: number;
  lastActiveAt: number;
  dueAt: number;
}

export interface TraceRecorderOptions {
  onCapture: (capture: TraceCapture) => void;
  /** Kesit kimliği üreteci (testlerde sabit) */
  newId?: () => string;
}

const randomId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class VoiceTraceRecorder {
  private channelId: string | null = null;
  private ring: VoiceTraceSample[] = [];
  private marks: VoiceTraceMark[] = [];
  private seq = 0;
  private lastAt = 0;
  private intervalMs = 1000;
  private prevOut = new Map<string, TraceOut>();
  private prevIn = new Map<string, TraceIn>();
  private prevPair: TracePair | null = null;
  private pairIndex = 0;
  private prevUnderruns: number | null = null;
  /** Gelen görüntü akışlarının sıra numaraları ve kare çözmeye başlayanlar */
  private videoIndex = new Map<string, number>();
  private videoSeq = 0;
  private decoding = new Set<string>();
  // STUN: yanıtlanmamış ilk isteğin görüldüğü an (null: yol canlı)
  private stunPendingSince: number | null = null;
  private stunStaleMs = 0;
  // Tetikleyici durumları
  private lossRun = new Map<VoiceTraceUplinkKind, LossRun>();
  /** Gelen ortam (RTP) paketinin görüldüğü son ölçümün anı */
  private lastInboundMediaAt = Number.NEGATIVE_INFINITY;
  private blackout = new Hold();
  private conceal = new Hold();
  /** Gelen veri hızının (bayt/sn) yumuşatılmış değeri; yalnızca veri gelen ölçümlerde güncellenir */
  private inRate = 0;
  private everConnected = false;
  private pending: PendingCapture | null = null;
  private request: { eventId: string; reason: string; at: number } | null = null;
  private lastRequestCutAt = Number.NEGATIVE_INFINITY;
  private seenEvents: string[] = [];
  private lastCutAt = Number.NEGATIVE_INFINITY;
  private lastSentSeq = 0;
  private lastSentMarkAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly opts: TraceRecorderOptions) {}

  /** Sese bağlanınca: tampon ve sayaçlar sıfırlanır */
  start(channelId: string): void {
    if (this.channelId === channelId && this.lastAt) return;
    this.clear();
    this.channelId = channelId;
  }

  /**
   * Sesten ayrılınca: bekleyen kesit (tetiklenmiş ama süresi dolmamış) o ana kadarki ölçümlerle verilir,
   * sonra tampon boşaltılır.
   */
  stop(at: number): void {
    try {
      if (this.pending) this.cut(at, this.pending, null, false);
    } catch {
      // ölçüm görüşmeyi etkilemez
    }
    this.clear();
    this.channelId = null;
  }

  private clear(): void {
    this.ring = [];
    this.marks = [];
    this.lastAt = 0;
    this.prevOut = new Map();
    this.prevIn = new Map();
    this.prevPair = null;
    this.prevUnderruns = null;
    this.videoIndex = new Map();
    this.decoding = new Set();
    this.stunPendingSince = null;
    this.stunStaleMs = 0;
    this.lossRun = new Map();
    this.blackout.reset();
    this.conceal.reset();
    this.inRate = 0;
    this.lastInboundMediaAt = Number.NEGATIVE_INFINITY;
    this.everConnected = false;
    this.pending = null;
    this.request = null;
    this.lastSentSeq = this.seq;
  }

  /** Ping'in (aday çiftinin gidiş-dönüş süresi) eskidiği süre (ms): yanıtsız ilk STUN isteğinden beri; 0: taze */
  get pingStaleMs(): number {
    return this.stunStaleMs;
  }

  /** Halkadaki ölçüm sayısı (tanılama ve testler) */
  get size(): number {
    return this.ring.length;
  }

  /**
   * İşaret: yeniden bağlanma ve motor olayları. `trigger` verilirse kesit de tetiklenir (ölçüm beklemeden).
   */
  mark(at: number, label: string, trigger?: TraceReason): void {
    if (!this.channelId) return;
    try {
      this.marks.push({ t: at, l: label.slice(0, 48) });
      if (this.marks.length > VOICE_TRACE_MAX_MARKS * 2) this.marks.splice(0, this.marks.length - VOICE_TRACE_MAX_MARKS * 2);
      if (trigger) this.trigger(at, [trigger]);
    } catch {
      // ölçüm görüşmeyi etkilemez
    }
  }

  /**
   * Sunucu isteği (VOICE_TRACE_REQUEST): halkadaki (daha önce gönderilmemiş) ölçümler bir sonraki ölçümde
   * gönderilir. Aynı istek ikinci kez ve çok sık gelen istekler yok sayılır.
   */
  requestCapture(at: number, eventId: string, reason: string, channelId?: string): boolean {
    if (!this.channelId || (channelId !== undefined && channelId !== this.channelId)) return false;
    if (this.seenEvents.includes(eventId)) return false;
    this.seenEvents.push(eventId);
    if (this.seenEvents.length > 20) this.seenEvents.shift();
    if (this.request || at - this.lastRequestCutAt < VOICE_TRACE_REQUEST_GAP_MS) return false;
    this.request = { eventId, reason: reason.slice(0, 48), at };
    this.mark(at, `request:${reason}`);
    return true;
  }

  /** Platformun saniyelik ölçümü. Hatalar yutulur: ölçüm görüşmeyi asla etkilemez. */
  sample(input: TraceSampleInput): void {
    try {
      this.add(input);
    } catch {
      // ölçüm görüşmeyi etkilemez
    }
  }

  private add(input: TraceSampleInput): void {
    if (!this.channelId) return;
    const at = input.at;
    const gap = this.lastAt ? at - this.lastAt : 0;
    if (this.lastAt && gap < MIN_SAMPLE_GAP_MS) return;
    const totals = parseTraceTotals(input.reports);
    const fresh = !this.lastAt || gap > MAX_SAMPLE_GAP_MS;
    if (fresh) {
      // İlk ölçüm ya da uzun boşluk: farklar bir sonraki ölçümden başlar
      this.remember(totals, input);
      this.lastAt = at;
      this.stunPendingSince = null;
      this.stunStaleMs = 0;
      this.lossRun.clear();
      this.blackout.reset();
      this.conceal.reset();
      return;
    }
    const dt = gap;
    // Ölçüm aralığı: gözlenen en küçük "tam" aralığa yakınsar (masaüstü ~1000, telefon ~2000)
    this.intervalMs = Math.round(dt / 500) * 500 || 500;

    const x = this.transport(totals.pair, at, input);
    const up = uplinkDeltas(totals.out, this.prevOut, input.kinds);
    const { da, dv, ids } = downlinkDeltas(totals.in, this.prevIn, (id) => this.indexOfVideo(id));
    const underruns = diff(input.micUnderruns, this.prevUnderruns);
    const sample: VoiceTraceSample = { q: ++this.seq, t: at, dt, x, up };
    if (da) sample.da = da;
    if (dv.length > 0) sample.dv = dv;
    if (input.lagMs !== null && input.lagMs !== undefined) sample.lag = Math.round(input.lagMs);
    if (underruns !== null) sample.un = underruns;
    this.ring.push(sample);
    const from = at - VOICE_TRACE_RING_MS;
    while (this.ring.length > 0 && (this.ring[0]!.t < from || this.ring.length > VOICE_TRACE_MAX_SAMPLES)) this.ring.shift();
    while (this.marks.length > 0 && this.marks[0]!.t < from) this.marks.shift();

    const reasons = this.evaluate(sample, ids);
    this.remember(totals, input);
    this.lastAt = at;
    if (reasons.length > 0) {
      // İşaret yalnızca neden bu kesitte ilk kez görüldüğünde (koşul sürdükçe tekrarlanmaz)
      for (const r of reasons) if (!this.pending?.reasons.has(r)) this.marks.push({ t: at, l: `trigger:${r}` });
      this.trigger(at, reasons);
    }
    this.flushDue(at);
  }

  private remember(totals: TraceTotals, input: TraceSampleInput): void {
    this.prevOut = new Map(totals.out.map((s) => [s.id, s]));
    this.prevIn = new Map(totals.in.map((s) => [s.id, s]));
    if (totals.pair && totals.pair.id !== this.prevPair?.id) this.pairIndex++;
    this.prevPair = totals.pair;
    this.prevUnderruns = input.micUnderruns ?? null;
    for (const id of this.videoIndex.keys()) if (!this.prevIn.has(id)) this.videoIndex.delete(id);
    for (const id of this.decoding) if (!this.prevIn.has(id)) this.decoding.delete(id);
  }

  private indexOfVideo(id: string): number {
    let i = this.videoIndex.get(id);
    if (i === undefined) {
      i = ++this.videoSeq;
      this.videoIndex.set(id, i);
    }
    return i;
  }

  private transport(pair: TracePair | null, at: number, input: TraceSampleInput): VoiceTraceTransport | null {
    const prev = this.prevPair;
    if (!pair) {
      this.stunPendingSince = null;
      this.stunStaleMs = 0;
      return input.ice || input.pc ? this.stateOnly(input) : null;
    }
    const same = prev !== null && prev.id === pair.id;
    const sq = same ? diff(pair.requestsSent, prev.requestsSent) : null;
    const sr = same ? diff(pair.responsesReceived, prev.responsesReceived) : null;
    // STUN: yanıt geldiyse yol canlı; yanıt gelmeden istek gittiyse ilk yanıtsız isteğin anı tutulur
    if (!same || (sr ?? 0) > 0) this.stunPendingSince = null;
    else if ((sq ?? 0) > 0 && this.stunPendingSince === null) this.stunPendingSince = at;
    this.stunStaleMs = this.stunPendingSince === null ? 0 : at - this.stunPendingSince;
    const x: VoiceTraceTransport = {
      pi: same ? this.pairIndex : this.pairIndex + 1,
      rtt: pair.rttMs,
      sq,
      sr,
      su: this.stunStaleMs,
      ao: pair.availableOutgoingBitrate === null ? null : Math.round(pair.availableOutgoingBitrate),
      ai: pair.availableIncomingBitrate === null ? null : Math.round(pair.availableIncomingBitrate),
      bs: same ? diff(pair.bytesSent, prev.bytesSent) : null,
      br: same ? diff(pair.bytesReceived, prev.bytesReceived) : null,
      pd: same ? diff(pair.packetsDiscardedOnSend, prev.packetsDiscardedOnSend) : null,
    };
    if (!same && prev !== null) x.pch = 1;
    if (input.ice) x.ice = input.ice;
    if (input.pc) x.pc = input.pc;
    if (input.lk) x.lk = input.lk;
    if (pair.candidateType) x.ct = pair.candidateType;
    if (pair.protocol) x.pr = pair.protocol;
    return x;
  }

  private stateOnly(input: TraceSampleInput): VoiceTraceTransport {
    const x: VoiceTraceTransport = { pi: this.pairIndex, rtt: null, sq: null, sr: null, su: 0, ao: null, ai: null, bs: null, br: null, pd: null };
    if (input.ice) x.ice = input.ice;
    if (input.pc) x.pc = input.pc;
    if (input.lk) x.lk = input.lk;
    return x;
  }

  /**
   * Bu ölçümde geçerli olan nedenler. Koşul sürdükçe her ölçümde yeniden döner (kesit uzar); kesit
   * gönderildikten sonra hâlâ sürüyorsa yeni bir kesit başlar (gönderim aralığı sınırıyla).
   */
  private evaluate(sample: VoiceTraceSample, videoIds: readonly string[]): TraceReason[] {
    const reasons = new Set<TraceReason>();
    const { x, up, da, dv, dt } = sample;

    // Giden kayıp: bir türde art arda iki alıcı raporu aralığında eşik üstü (bkz. TRACE_LOSS_PCT)
    for (const u of up) if (this.lossBad(u, sample.t)) reasons.add('loss-out');

    if (x) {
      // STUN yanıtsız: ortamdan bağımsız "UDP yolu canlı mı" işareti
      if (x.su >= TRACE_STUN_UNANSWERED_MS) reasons.add('stun');
      // Bant genişliği tahmini çöktü (yayındayken): son 10 sn'nin ortancasının yarısının altı
      const streaming = up.some((u) => (u.k === 'scr' || u.k === 'v') && u.ps > 0);
      if (streaming && x.ao !== null) {
        const from = sample.t - TRACE_BWE_WINDOW_MS;
        const recent: number[] = [];
        for (const s of this.ring) {
          if (s === sample || s.t < from) continue;
          if (s.x?.ao !== null && s.x?.ao !== undefined) recent.push(s.x.ao);
        }
        if (recent.length >= TRACE_BWE_MIN_SAMPLES && x.ao < median(recent) * TRACE_BWE_DROP) reasons.add('bwe');
      }
      // Gelen akış tümüyle kesildi: veri gelirken art arda ölçümlerde (~2 sn) tek bayt gelmedi
      // (öncesinde ortam paketi gelirken ve STUN isteği yanıtsızken; bkz. TRACE_BLACKOUT_MIN_RATE)
      if (x.br !== null) {
        const dead =
          x.br === 0 &&
          x.su > 0 &&
          this.inRate >= TRACE_BLACKOUT_MIN_RATE &&
          sample.t - dt - this.lastInboundMediaAt <= TRACE_BLACKOUT_RECENT_MEDIA_MS;
        if (this.blackout.feed(dead, dt)) reasons.add('blackout');
        if (x.br > 0) {
          const rate = (x.br / dt) * 1000;
          this.inRate = this.inRate === 0 ? rate : this.inRate * 0.7 + rate * 0.3;
        } else {
          this.inRate *= TRACE_IN_RATE_DECAY;
        }
      }
      // Bağlantı "connected" durumundan çıktı (daha önce bağlıyken)
      const pc = x.pc ?? null;
      const ice = x.ice ?? null;
      const known = pc !== null || ice !== null;
      const connected = pc !== null ? pc === 'connected' : ice === 'connected' || ice === 'completed';
      const broken = known && (!connected || ice === 'disconnected' || ice === 'failed' || x.lk === 'lost');
      if (broken && this.everConnected) reasons.add('state');
      if (known && !broken) this.everConnected = true;
    }

    if ((da?.pr ?? 0) > 0 || (dv ?? []).some((v) => v.pr > 0)) this.lastInboundMediaAt = sample.t;

    // İzlenen yayın dondu: donma sayacı arttı ya da paket gelirken bir ölçüm boyunca kare çözülmedi
    (dv ?? []).forEach((v, n) => {
      const id = videoIds[n]!;
      const started = this.decoding.has(id);
      if ((v.fd ?? 0) > 0) this.decoding.add(id);
      const frozen = (v.fz ?? 0) > 0 && (v.fzd ?? 0) >= TRACE_FREEZE_MIN_MS;
      const stalled = started && v.fd === 0 && v.pr >= TRACE_STALL_MIN_PACKETS && dt >= TRACE_FULL_SAMPLE_MS;
      if (frozen || stalled) reasons.add('freeze');
    });

    // Gelen seste gizleme patlaması (sessizlik hariç gizlenen örnek oranı, ~2 sn)
    const concealing = !!da && da.ss !== null && da.ss > 0 && da.cs !== null && da.cs / da.ss >= TRACE_CONCEAL_RATIO;
    if (this.conceal.feed(concealing, dt)) reasons.add('conceal');
    return [...reasons];
  }

  /**
   * Giden akış türünün kaybı tetikleme eşiğinde mi. Paketler alıcı raporu gelene dek biriktirilir; rapor
   * gelen ölçümde aralığın oranı değerlendirilir. İstemci raporun geliş anını bildirmiyorsa (`rr` yok) her
   * ölçüm bir rapor aralığı sayılır.
   */
  private lossBad(u: VoiceTraceUp, at: number): boolean {
    let run = this.lossRun.get(u.k);
    if (!run) {
      run = { sent: 0, lost: 0, since: at, bad: 0, lastBadAt: Number.NEGATIVE_INFINITY };
      this.lossRun.set(u.k, run);
    }
    // Rapor çok uzun süredir gelmedi: eski paketler paydayı şişirmesin
    if (at - run.since > TRACE_LOSS_ACCUM_MS) {
      run.sent = 0;
      run.lost = 0;
      run.since = at;
    }
    run.sent += u.ps;
    run.lost += u.pl ?? 0;
    const reported = u.rr === undefined || u.rr === null ? true : u.rr > 0 || (u.pl ?? 0) > 0;
    if (!reported) return false;
    const bad =
      run.lost >= TRACE_LOSS_MIN_PACKETS && run.sent >= TRACE_LOSS_MIN_SENT && (run.lost / run.sent) * 100 >= TRACE_LOSS_PCT;
    run.sent = 0;
    run.lost = 0;
    run.since = at;
    if (!bad) {
      run.bad = 0;
      return false;
    }
    run.bad = at - run.lastBadAt <= TRACE_LOSS_RUN_GAP_MS ? run.bad + 1 : 1;
    run.lastBadAt = at;
    return run.bad >= 2;
  }

  private trigger(at: number, reasons: readonly TraceReason[]): void {
    const p = this.pending;
    if (p) {
      for (const r of reasons) p.reasons.add(r);
      p.lastActiveAt = at;
      // Sorun sürdükçe gönderim ertelenir; tetiklemeden önceki 60 sn halkadan düşmeden gönderilmeli
      const cap = p.triggerAt + (VOICE_TRACE_RING_MS - VOICE_TRACE_PRE_MS);
      p.dueAt = Math.max(p.dueAt, Math.min(cap, at + VOICE_TRACE_POST_MS));
      return;
    }
    this.pending = {
      reason: reasons[0]!,
      reasons: new Set(reasons),
      triggerAt: at,
      lastActiveAt: at,
      dueAt: Math.max(at + VOICE_TRACE_POST_MS, this.lastCutAt + VOICE_TRACE_MIN_GAP_MS),
    };
  }

  private flushDue(at: number): void {
    const req = this.request;
    if (req) {
      this.request = null;
      this.lastRequestCutAt = at;
      const own = this.pending;
      this.cut(
        at,
        {
          reason: 'request',
          reasons: new Set<TraceReason>(['request', ...(own?.reasons ?? [])]),
          triggerAt: req.at,
          lastActiveAt: own?.lastActiveAt ?? Number.NEGATIVE_INFINITY,
          dueAt: at,
        },
        req.eventId,
        true,
      );
    }
    const p = this.pending;
    if (p && at >= p.dueAt) {
      this.pending = null;
      this.cut(at, p, null, false);
      this.lastCutAt = at;
    }
  }

  /** Halkadan kesit çıkarır: daha önce gönderilmemiş ölçümler (isteğe bağlı olmayanlarda tetiklemeden 60 sn öncesinden) */
  private cut(at: number, p: PendingCapture, eventId: string | null, wholeRing: boolean): void {
    const channelId = this.channelId;
    if (!channelId) return;
    const from = wholeRing ? Number.NEGATIVE_INFINITY : p.triggerAt - VOICE_TRACE_PRE_MS;
    let samples = this.ring.filter((s) => s.q > this.lastSentSeq && s.t >= from);
    let truncated = false;
    if (samples.length > VOICE_TRACE_MAX_SAMPLES) {
      samples = samples.slice(-VOICE_TRACE_MAX_SAMPLES);
      truncated = true;
    }
    if (samples.length === 0) return;
    const first = samples[0]!.t - samples[0]!.dt;
    let marks = this.marks.filter((m) => m.t >= first && m.t > this.lastSentMarkAt);
    if (marks.length > VOICE_TRACE_MAX_MARKS) marks = marks.slice(-VOICE_TRACE_MAX_MARKS);
    this.lastSentSeq = samples[samples.length - 1]!.q;
    this.lastSentMarkAt = at;
    // Sorun kesit anında hâlâ sürüyorsa devamı ayrı bir kesitle gelir
    const ongoing = at - p.lastActiveAt <= this.intervalMs * 2;
    this.opts.onCapture({
      id: (this.opts.newId ?? randomId)(),
      channelId,
      reason: p.reason,
      reasons: [...p.reasons],
      eventId,
      triggerAt: p.triggerAt,
      more: truncated || ongoing,
      intervalMs: this.intervalMs,
      samples,
      marks,
    });
  }
}
