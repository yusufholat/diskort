/**
 * Ses bağlantısı istatistikleri: WebRTC `getStats()` çıktısını (tarayıcı ve react-native-webrtc aynı
 * alan adlarını kullanır) bağlantı panelinde gösterilecek değerlere çevirir. Platforma bağlı değildir;
 * rapor platformda alınır, burada yalnızca okunur. Oranlar (bit hızı, paket kaybı) iki ölçüm arasındaki
 * farktan hesaplanır.
 */

/** getStats() raporundaki tek kayıt */
export interface RtcStat {
  id: string;
  type: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** RTCStatsReport (Map benzeri) ya da düz dizi */
export type StatsSource = { forEach(cb: (stat: unknown) => void): void } | Iterable<unknown>;

export interface CandidateInfo {
  /** host (doğrudan), srflx/prflx (NAT üzerinden), relay (TURN aktarıcısı) */
  candidateType: string | null;
  /** Aday ile kurulan bağlantı: udp ya da tcp */
  protocol: string | null;
  /** Aktarıcıya (TURN) giden bağlantı: udp, tcp ya da tls */
  relayProtocol: string | null;
  address: string | null;
  port: number | null;
  networkType: string | null;
}

export interface RtpStream {
  id: string;
  direction: 'out' | 'in';
  kind: 'audio' | 'video';
  /** MediaStreamTrack kimliği (izin hangi kullanıcıya/kaynağa ait olduğunu bulmak için) */
  trackId: string | null;
  /** ör. "audio/opus" */
  codec: string | null;
  clockRate: number | null;
  channels: number | null;
  /** Gönderilen (giden) ya da alınan (gelen) paket sayısı, toplam */
  packets: number;
  bytes: number;
  /** Kaybolan paket sayısı, toplam (giden için karşı tarafın raporu: remote-inbound-rtp) */
  packetsLost: number | null;
  jitterMs: number | null;
  /** Yalnızca giden: karşı tarafın RTCP raporundan ölçülen gidiş-dönüş süresi */
  rttMs: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  /** Kodlayıcı/çözücü (ör. "NvEnc", "libvpx", "ExternalDecoder") */
  implementation: string | null;
  /** Yalnızca giden görüntü: çözünürlük/kare hızı neden düşürüldü (cpu, bandwidth, none) */
  qualityLimitationReason: string | null;
  /** Ses: gizlenen (kayıp yüzünden sentezlenen) örnek sayısı, toplam */
  concealedSamples: number | null;
  totalSamplesReceived: number | null;
}

/** Tek bir RTCPeerConnection'ın (yayın ya da abonelik bağlantısı) o anki toplamları */
export interface TransportStats {
  at: number;
  rttMs: number | null;
  availableOutgoingBitrate: number | null;
  availableIncomingBitrate: number | null;
  bytesSent: number;
  bytesReceived: number;
  local: CandidateInfo | null;
  remote: CandidateInfo | null;
  dtlsState: string | null;
  tlsVersion: string | null;
  dtlsCipher: string | null;
  srtpCipher: string | null;
  streams: RtpStream[];
}

export interface StreamView extends RtpStream {
  /** bit/sn; önceki ölçüm yoksa null */
  bitrate: number | null;
  /** Son iki ölçüm arasındaki paket kaybı (%) */
  lossPercent: number | null;
}

export interface TransportView extends Omit<TransportStats, 'streams'> {
  bitrateOut: number | null;
  bitrateIn: number | null;
  streams: StreamView[];
}

// ---------- Rapor okuma ----------

function isStat(value: unknown): value is RtcStat {
  return typeof value === 'object' && value !== null && typeof (value as RtcStat).type === 'string';
}

export function statList(report: StatsSource): RtcStat[] {
  const out: RtcStat[] = [];
  const add = (v: unknown): void => {
    if (isStat(v)) out.push(v);
  };
  if (typeof (report as { forEach?: unknown }).forEach === 'function') {
    (report as { forEach(cb: (stat: unknown) => void): void }).forEach(add);
  } else {
    for (const v of report as Iterable<unknown>) add(v);
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const ms = (seconds: unknown): number | null => {
  const s = num(seconds);
  return s === null ? null : Math.round(s * 1000);
};

function candidate(stat: RtcStat | undefined): CandidateInfo | null {
  if (!stat) return null;
  return {
    candidateType: str(stat.candidateType),
    protocol: str(stat.protocol),
    relayProtocol: str(stat.relayProtocol),
    address: str(stat.address) ?? str(stat.ip),
    port: num(stat.port),
    networkType: str(stat.networkType),
  };
}

/** Seçili aday çifti: transport.selectedCandidatePairId, yoksa aday çiftlerinin işaretlerinden */
function selectedPair(stats: RtcStat[], byId: Map<string, RtcStat>): RtcStat | undefined {
  for (const s of stats) {
    if (s.type !== 'transport') continue;
    const pair = byId.get(str(s.selectedCandidatePairId) ?? '');
    if (pair) return pair;
  }
  const pairs = stats.filter((s) => s.type === 'candidate-pair');
  return (
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded' && num(p.currentRoundTripTime) !== null) ??
    pairs.find((p) => p.nominated === true && p.state === 'succeeded') ??
    pairs.find((p) => p.nominated === true && num(p.currentRoundTripTime) !== null)
  );
}

function codecOf(stat: RtcStat, byId: Map<string, RtcStat>): Pick<RtpStream, 'codec' | 'clockRate' | 'channels'> {
  const codec = byId.get(str(stat.codecId) ?? '');
  return {
    codec: codec ? str(codec.mimeType) : null,
    clockRate: codec ? num(codec.clockRate) : null,
    channels: codec ? num(codec.channels) : null,
  };
}

function kindOf(stat: RtcStat): 'audio' | 'video' {
  return (stat.kind ?? stat.mediaType) === 'video' ? 'video' : 'audio';
}

/** Tek bağlantının getStats() raporunu okur; hiç veri yoksa null. */
export function parseTransportStats(report: StatsSource, at: number = Date.now()): TransportStats | null {
  const stats = statList(report);
  if (stats.length === 0) return null;
  const byId = new Map(stats.map((s) => [s.id, s]));
  const remoteInbound = new Map<string, RtcStat>();
  for (const s of stats) {
    if (s.type === 'remote-inbound-rtp' && str(s.localId)) remoteInbound.set(s.localId as string, s);
  }

  const pair = selectedPair(stats, byId);
  const transport = stats.find((s) => s.type === 'transport');
  const streams: RtpStream[] = [];

  for (const s of stats) {
    if (s.type === 'outbound-rtp') {
      // Yayında olmayan simulcast katmanları (active: false) ve hiç paket göndermemiş akışlar atlanır
      if (s.active === false) continue;
      const remote = remoteInbound.get(s.id) ?? stats.find((r) => r.type === 'remote-inbound-rtp' && r.ssrc === s.ssrc);
      const source = byId.get(str(s.mediaSourceId) ?? '');
      streams.push({
        id: s.id,
        direction: 'out',
        kind: kindOf(s),
        trackId: source ? str(source.trackIdentifier) : null,
        ...codecOf(s, byId),
        packets: num(s.packetsSent) ?? 0,
        bytes: num(s.bytesSent) ?? 0,
        packetsLost: remote ? num(remote.packetsLost) : null,
        jitterMs: remote ? ms(remote.jitter) : null,
        rttMs: remote ? ms(remote.roundTripTime) : null,
        frameWidth: num(s.frameWidth),
        frameHeight: num(s.frameHeight),
        framesPerSecond: num(s.framesPerSecond),
        implementation: str(s.encoderImplementation),
        qualityLimitationReason: str(s.qualityLimitationReason),
        concealedSamples: null,
        totalSamplesReceived: null,
      });
    } else if (s.type === 'inbound-rtp') {
      streams.push({
        id: s.id,
        direction: 'in',
        kind: kindOf(s),
        trackId: str(s.trackIdentifier) ?? str(byId.get(str(s.trackId) ?? '')?.trackIdentifier),
        ...codecOf(s, byId),
        packets: num(s.packetsReceived) ?? 0,
        bytes: num(s.bytesReceived) ?? 0,
        packetsLost: num(s.packetsLost),
        jitterMs: ms(s.jitter),
        rttMs: null,
        frameWidth: num(s.frameWidth),
        frameHeight: num(s.frameHeight),
        framesPerSecond: num(s.framesPerSecond),
        implementation: str(s.decoderImplementation),
        qualityLimitationReason: null,
        concealedSamples: num(s.concealedSamples),
        totalSamplesReceived: num(s.totalSamplesReceived),
      });
    }
  }

  const security = transport ?? pair;
  return {
    at,
    rttMs: pair ? ms(pair.currentRoundTripTime) : null,
    availableOutgoingBitrate: pair ? num(pair.availableOutgoingBitrate) : null,
    availableIncomingBitrate: pair ? num(pair.availableIncomingBitrate) : null,
    bytesSent: num(transport?.bytesSent) ?? num(pair?.bytesSent) ?? 0,
    bytesReceived: num(transport?.bytesReceived) ?? num(pair?.bytesReceived) ?? 0,
    local: candidate(byId.get(str(pair?.localCandidateId) ?? '')),
    remote: candidate(byId.get(str(pair?.remoteCandidateId) ?? '')),
    dtlsState: str(transport?.dtlsState),
    tlsVersion: str(security?.tlsVersion),
    dtlsCipher: str(security?.dtlsCipher),
    srtpCipher: str(security?.srtpCipher),
    streams,
  };
}

// ---------- İki ölçüm arasındaki değişim ----------

const rate = (bytes: number, prevBytes: number, seconds: number): number | null =>
  seconds > 0 && bytes >= prevBytes ? Math.round(((bytes - prevBytes) * 8) / seconds) : null;

/** Paket kaybı yüzdesi (0–100); hesaplanamıyorsa null */
function lossPercent(lost: number, total: number): number | null {
  if (total <= 0) return lost > 0 ? 100 : null;
  return Math.min(100, Math.max(0, (lost / total) * 100));
}

/**
 * Bağlantıyı ekranda gösterilecek hale getirir: bit hızları ve akış başına paket kaybı önceki ölçümle
 * karşılaştırılarak hesaplanır (yeniden yayınlanan akışın kimliği değişir, o akış için oran boş kalır).
 */
export function describeTransport(curr: TransportStats, prev: TransportStats | null): TransportView {
  const seconds = prev ? (curr.at - prev.at) / 1000 : 0;
  const prevStreams = new Map(prev?.streams.map((s) => [s.id, s]));
  const streams = curr.streams.map((s): StreamView => {
    const p = prevStreams.get(s.id);
    if (!p) return { ...s, bitrate: null, lossPercent: null };
    const dPackets = Math.max(0, s.packets - p.packets);
    const dLost = s.packetsLost !== null && p.packetsLost !== null ? Math.max(0, s.packetsLost - p.packetsLost) : null;
    return {
      ...s,
      bitrate: rate(s.bytes, p.bytes, seconds),
      // Giden: kaybolan / gönderilen; gelen: kaybolan / (alınan + kaybolan)
      lossPercent: dLost === null ? null : lossPercent(dLost, s.direction === 'out' ? dPackets : dPackets + dLost),
    };
  });
  const { streams: _omit, ...rest } = curr;
  return {
    ...rest,
    bitrateOut: prev ? rate(curr.bytesSent, prev.bytesSent, seconds) : null,
    bitrateIn: prev ? rate(curr.bytesReceived, prev.bytesReceived, seconds) : null,
    streams,
  };
}

// ---------- Ping geçmişi (grafik ve bağlantı kalitesi) ----------

export interface PingSample {
  at: number;
  rttMs: number | null;
  /** Bu ölçümle bir öncekinin arasında giden paket sayısı */
  sent: number;
  /** Aynı aralıkta karşı tarafın kayıp bildirdiği giden paket sayısı */
  lost: number;
}

/** Grafikte gösterilen süre */
export const PING_HISTORY_MS = 5 * 60_000;

/** İki ölçüm arasında giden paketler ve kayıpları (yalnızca iki ölçümde de bulunan akışlar sayılır) */
export function outboundDelta(curr: TransportStats | null, prev: TransportStats | null): { sent: number; lost: number } {
  if (!curr || !prev) return { sent: 0, lost: 0 };
  const prevStreams = new Map(prev.streams.map((s) => [s.id, s]));
  let sent = 0;
  let lost = 0;
  for (const s of curr.streams) {
    const p = prevStreams.get(s.id);
    if (s.direction !== 'out' || !p) continue;
    sent += Math.max(0, s.packets - p.packets);
    if (s.packetsLost !== null && p.packetsLost !== null) lost += Math.max(0, s.packetsLost - p.packetsLost);
  }
  return { sent, lost };
}

/** Halka arabellek: yeni ölçümü ekler, `windowMs`'ten eskileri atar (yeni dizi döner). */
export function pushSample(samples: readonly PingSample[], sample: PingSample, windowMs = PING_HISTORY_MS): PingSample[] {
  const from = sample.at - windowMs;
  const kept = samples.filter((s) => s.at >= from && s.at < sample.at);
  kept.push(sample);
  return kept;
}

export interface PingSummary {
  averageMs: number | null;
  lastMs: number | null;
  /** Giden paket kayıp oranı (%) */
  lossPercent: number | null;
}

/** Ortalama ve son ping ile giden paket kaybı; `sinceMs` verilirse yalnızca o andan sonraki ölçümler. */
export function summarizePings(samples: readonly PingSample[], sinceMs = -Infinity): PingSummary {
  let total = 0;
  let count = 0;
  let last: number | null = null;
  let sent = 0;
  let lost = 0;
  for (const s of samples) {
    if (s.at < sinceMs) continue;
    if (s.rttMs !== null) {
      total += s.rttMs;
      count++;
      last = s.rttMs;
    }
    sent += s.sent;
    lost += s.lost;
  }
  return {
    averageMs: count ? Math.round(total / count) : null,
    lastMs: last,
    lossPercent: sent > 0 || lost > 0 ? lossPercent(lost, sent) : null,
  };
}

export type LinkQuality = 'good' | 'fair' | 'poor' | 'unknown';

/**
 * Discord'daki gibi yeşil/sarı/kırmızı: 250 ms ve üstü gecikmede ya da %10 üstü kayıpta ses bozulur,
 * 120 ms / %3 üstü "idare eder".
 */
export function linkQuality(pingMs: number | null, lossPercent: number | null): LinkQuality {
  if (pingMs === null && lossPercent === null) return 'unknown';
  const ping = pingMs ?? 0;
  const loss = lossPercent ?? 0;
  if (ping >= 250 || loss >= 10) return 'poor';
  if (ping >= 120 || loss >= 3) return 'fair';
  return 'good';
}

/** Ping grafiğinin dikey ekseni: en az 100 ms, 50'nin katlarına yuvarlanır; üç çizgi (0, orta, üst). */
export function pingAxis(samples: readonly PingSample[]): { max: number; ticks: number[] } {
  let peak = 0;
  for (const s of samples) if (s.rttMs !== null && s.rttMs > peak) peak = s.rttMs;
  const step = peak > 1000 ? 500 : peak > 400 ? 100 : 50;
  const max = Math.max(100, Math.ceil((peak * 1.1) / (step * 2)) * step * 2);
  return { max, ticks: [0, max / 2, max] };
}

/** Yatay eksendeki saat etiketleri: aralıktaki dakika başları, en fazla `maxLabels` tane. */
export function minuteTicks(from: number, to: number, maxLabels = 5): number[] {
  const minute = 60_000;
  const span = to - from;
  if (span <= 0) return [];
  const every = [1, 2, 5, 10, 15, 30, 60].find((m) => span / (m * minute) <= maxLabels) ?? 60;
  const stepMs = every * minute;
  const out: number[] = [];
  for (let t = Math.ceil(from / stepMs) * stepMs; t <= to; t += stepMs) out.push(t);
  return out;
}

// ---------- Metinler ----------

/** "Aktarıcı (TURN) · TLS", "Doğrudan · UDP" gibi */
export function describeCandidate(c: CandidateInfo | null): string {
  if (!c) return 'Bilinmiyor';
  const type =
    c.candidateType === 'relay'
      ? 'Aktarıcı (TURN)'
      : c.candidateType === 'host'
        ? 'Doğrudan (host)'
        : c.candidateType === 'srflx' || c.candidateType === 'prflx'
          ? `NAT üzerinden (${c.candidateType})`
          : (c.candidateType ?? 'Bilinmiyor');
  const proto = (c.candidateType === 'relay' && c.relayProtocol ? c.relayProtocol : c.protocol)?.toUpperCase();
  return proto ? `${type} · ${proto}` : type;
}

export function formatBitrate(bps: number | null): string {
  if (bps === null) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 0 : 1).replace('.', ',')} Mb/sn`;
  return `${Math.round(bps / 1000)} kb/sn`;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `%${value.toFixed(1).replace('.', ',')}`;
}
