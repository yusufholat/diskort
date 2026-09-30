import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from './counters.js';

// Yönetim paneli: sunucu makinesinin ağ geçmişi. API kapsayıcısı host ağında çalıştığından /proc/net/dev
// ve /proc/net/snmp makinenin gerçek sayaçlarıdır. Amaç: sağlayıcı tarafında bir hız sınırı ya da DDoS
// süzgeci varsa (birden çok kullanıcıda aynı anda paket kaybı) bunu sonradan ilişkilendirebilmek.
// - Her ölçümde (15 sn) varsayılan yoldaki arayüzün ve UDP'nin sayaç farklarından hızlar (bellekte, 30 dk).
// - Her dakikanın özeti <dataDir>/telemetry/network-YYYY-AA-GG.jsonl dosyasına eklenir (yeniden başlatmadan
//   sonra da görülebilsin; 14 gün saklanır).

/** /proc/net/dev: bir arayüzün sayaçları */
export interface NetDevCounters {
  rxBytes: number;
  rxPackets: number;
  rxErrs: number;
  rxDrop: number;
  txBytes: number;
  txPackets: number;
  txErrs: number;
  txDrop: number;
}

/** /proc/net/snmp "Udp:" satırı */
export interface UdpCounters {
  inDatagrams: number;
  inErrors: number;
  outDatagrams: number;
  rcvbufErrors: number;
  sndbufErrors: number;
}

/** Bir anda okunan ham sayaçlar */
export interface HostNetCounters {
  at: number;
  iface: string;
  dev: NetDevCounters;
  /** /proc/net/snmp okunamadıysa null */
  udp: UdpCounters | null;
}

/** İki okuma arasındaki hızlar (saniyede); sayaç geri gittiyse (sıfırlandıysa) ilgili alan null */
export interface HostNetSample {
  at: number;
  iface: string;
  rxMbps: number | null;
  txMbps: number | null;
  rxPps: number | null;
  txPps: number | null;
  rxDropPerSec: number | null;
  rxErrPerSec: number | null;
  udpInPerSec: number | null;
  udpOutPerSec: number | null;
  udpInErrPerSec: number | null;
  udpRcvbufErrPerSec: number | null;
  udpSndbufErrPerSec: number | null;
}

const finite = (n: number): boolean => Number.isFinite(n);

/** /proc/net/dev: arayüz adı → sayaçlar */
export function parseNetDevDetailed(text: string): Record<string, NetDevCounters> {
  const result: Record<string, NetDevCounters> = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const f = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (!name || name.includes('|') || f.length < 10) continue;
    // rx: bayt paket hata düşen ... (0-7); tx: bayt paket ... (8-)
    const dev: NetDevCounters = {
      rxBytes: f[0]!,
      rxPackets: f[1]!,
      rxErrs: f[2]!,
      rxDrop: f[3]!,
      txBytes: f[8]!,
      txPackets: f[9]!,
      txErrs: f[10]!,
      txDrop: f[11]!,
    };
    if (Object.values(dev).every(finite)) result[name] = dev;
  }
  return result;
}

/**
 * /proc/net/route: varsayılan yolun (hedef ve maske 0.0.0.0, ayakta) arayüzü; birden çoksa en düşük
 * metrik. Bulunamazsa null.
 */
export function parseDefaultRouteInterface(text: string): string | null {
  let best: { iface: string; metric: number } | null = null;
  for (const line of text.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    const [iface, destination, , flags, , , metric, mask] = c;
    if (!iface || destination !== '00000000' || mask !== '00000000') continue;
    const f = Number.parseInt(flags ?? '1', 16);
    if (Number.isFinite(f) && (f & 1) === 0) continue; // RTF_UP yok
    const m = Number(metric);
    const rank = Number.isFinite(m) ? m : 0;
    if (!best || rank < best.metric) best = { iface, metric: rank };
  }
  return best?.iface ?? null;
}

/** /proc/net/route: varsayılan yolun ağ geçidi (IPv4, noktalı); bulunamazsa null. Adres küçük-endian onaltılıktır. */
export function parseDefaultGateway(text: string): string | null {
  let best: { gw: string; metric: number } | null = null;
  for (const line of text.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    const [iface, destination, gateway, flags, , , metric, mask] = c;
    if (!iface || destination !== '00000000' || mask !== '00000000' || !gateway || !/^[0-9A-Fa-f]{8}$/.test(gateway)) continue;
    const f = Number.parseInt(flags ?? '1', 16);
    if (Number.isFinite(f) && (f & 1) === 0) continue;
    if (gateway === '00000000') continue; // doğrudan bağlı yol: ağ geçidi yok
    const m = Number(metric);
    const rank = Number.isFinite(m) ? m : 0;
    if (!best || rank < best.metric) {
      const b = [6, 4, 2, 0].map((i) => Number.parseInt(gateway.slice(i, i + 2), 16));
      best = { gw: b.join('.'), metric: rank };
    }
  }
  return best?.gw ?? null;
}

/** /proc/net/snmp içindeki "Udp:" başlık + değer satırı çifti (UdpLite: ayrı sayılır) */
export function parseSnmpUdp(text: string): UdpCounters | null {
  const rows = text.split('\n').filter((l) => l.startsWith('Udp:'));
  if (rows.length < 2) return null;
  const names = rows[0]!.trim().split(/\s+/).slice(1);
  const values = rows[1]!.trim().split(/\s+/).slice(1).map(Number);
  const get = (name: string): number | null => {
    const i = names.indexOf(name);
    const v = i >= 0 ? values[i] : undefined;
    return v !== undefined && Number.isFinite(v) ? v : null;
  };
  const inDatagrams = get('InDatagrams');
  const outDatagrams = get('OutDatagrams');
  if (inDatagrams === null || outDatagrams === null) return null;
  return {
    inDatagrams,
    outDatagrams,
    inErrors: get('InErrors') ?? 0,
    rcvbufErrors: get('RcvbufErrors') ?? 0,
    sndbufErrors: get('SndbufErrors') ?? 0,
  };
}

/** /proc dosyalarının metninden bir okuma; arayüz bulunamazsa ya da okunamazsa null */
export function readHostNet(
  files: { dev: string | null; route: string | null; snmp: string | null },
  at: number,
): HostNetCounters | null {
  if (!files.dev || !files.route) return null;
  const iface = parseDefaultRouteInterface(files.route);
  if (!iface) return null;
  const dev = parseNetDevDetailed(files.dev)[iface];
  if (!dev) return null;
  return { at, iface, dev, udp: files.snmp ? parseSnmpUdp(files.snmp) : null };
}

/** İki okumadan hızlar; arayüz değiştiyse ya da süre geçmediyse null */
export function hostNetSample(cur: HostNetCounters, prev: HostNetCounters): HostNetSample | null {
  const dt = (cur.at - prev.at) / 1000;
  if (dt <= 0 || cur.iface !== prev.iface) return null;
  // Sayaç geri gittiyse (sıfırlanma / yeniden başlatma) o alan için hız bilinmez
  const rate = (c: number | undefined, p: number | undefined, scale = 1): number | null =>
    c === undefined || p === undefined || c < p ? null : ((c - p) / dt) * scale;
  const mbps = 8 / 1_000_000;
  return {
    at: cur.at,
    iface: cur.iface,
    rxMbps: rate(cur.dev.rxBytes, prev.dev.rxBytes, mbps),
    txMbps: rate(cur.dev.txBytes, prev.dev.txBytes, mbps),
    rxPps: rate(cur.dev.rxPackets, prev.dev.rxPackets),
    txPps: rate(cur.dev.txPackets, prev.dev.txPackets),
    rxDropPerSec: rate(cur.dev.rxDrop, prev.dev.rxDrop),
    rxErrPerSec: rate(cur.dev.rxErrs, prev.dev.rxErrs),
    udpInPerSec: rate(cur.udp?.inDatagrams, prev.udp?.inDatagrams),
    udpOutPerSec: rate(cur.udp?.outDatagrams, prev.udp?.outDatagrams),
    udpInErrPerSec: rate(cur.udp?.inErrors, prev.udp?.inErrors),
    udpRcvbufErrPerSec: rate(cur.udp?.rcvbufErrors, prev.udp?.rcvbufErrors),
    udpSndbufErrPerSec: rate(cur.udp?.sndbufErrors, prev.udp?.sndbufErrors),
  };
}

// ---------- Dakikalık özet ----------

/** Dosyaya eklenen satır: bir dakikanın özeti */
export interface HostNetMinute {
  /** Dakikanın başı (ms) ve okunaklı karşılığı (UTC) */
  at: number;
  t: string;
  iface: string;
  /** Dakikadaki ölçüm sayısı */
  n: number;
  rxMbpsMax: number | null;
  txMbpsMax: number | null;
  /** En yüksek düşen paket hızı (rx_dropped/sn) */
  dropMax: number | null;
  /** UDP hata sayıları (dakikadaki toplam paket): InErrors (RcvbufErrors dahil), RcvbufErrors, SndbufErrors */
  udpInErr: number;
  udpRcvbufErr: number;
  udpSndbufErr: number;
}

const MINUTE = 60_000;
const round = (v: number | null, digits = 2): number | null => (v === null ? null : Number(v.toFixed(digits)));
const maxOf = (values: (number | null)[]): number | null => {
  const v = values.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.max(...v);
};

/** Bir dakikaya düşen hız ölçümlerinden özet. Hata sayısı: hız × ölçüm aralığı toplamı */
export function summarizeMinute(minuteStart: number, samples: HostNetSample[], intervalsSec: number[]): HostNetMinute {
  const total = (pick: (s: HostNetSample) => number | null): number =>
    Math.round(samples.reduce((sum, s, i) => sum + (pick(s) ?? 0) * (intervalsSec[i] ?? 0), 0));
  return {
    at: minuteStart,
    t: new Date(minuteStart).toISOString(),
    iface: samples[samples.length - 1]?.iface ?? '',
    n: samples.length,
    rxMbpsMax: round(maxOf(samples.map((s) => s.rxMbps))),
    txMbpsMax: round(maxOf(samples.map((s) => s.txMbps))),
    dropMax: round(maxOf(samples.map((s) => s.rxDropPerSec))),
    udpInErr: total((s) => s.udpInErrPerSec),
    udpRcvbufErr: total((s) => s.udpRcvbufErrPerSec),
    udpSndbufErr: total((s) => s.udpSndbufErrPerSec),
  };
}

/** Ölçümleri dakikalara böler; bir dakika bitince özetini verir */
export class MinuteSummarizer {
  private minute: number | null = null;
  private samples: HostNetSample[] = [];
  private intervals: number[] = [];
  private lastAt: number | null = null;

  /** Yeni ölçüm; önceki dakika bittiyse onun özeti döner */
  push(sample: HostNetSample): HostNetMinute | null {
    const minute = Math.floor(sample.at / MINUTE) * MINUTE;
    let done: HostNetMinute | null = null;
    if (this.minute !== null && minute !== this.minute) {
      done = summarizeMinute(this.minute, this.samples, this.intervals);
      this.samples = [];
      this.intervals = [];
    }
    this.minute = minute;
    this.samples.push(sample);
    // Ölçümün kapsadığı süre (bir önceki ölçümden bu yana); ilk ölçümde 15 sn varsayılır
    this.intervals.push(this.lastAt === null ? 15 : Math.max(0, Math.min(120, (sample.at - this.lastAt) / 1000)));
    this.lastAt = sample.at;
    return done;
  }
}

// ---------- Dosya ----------

const FILE = /^network-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Dakikalık özetleri günlük dosyalara ekler; eski günleri siler */
export class HostNetworkLog {
  private readonly summarizer = new MinuteSummarizer();
  private warned = false;
  private lastCleanup = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string | null,
    private readonly offsetMin: number,
    private readonly retentionDays = 14,
    private readonly log?: { warn(obj: object, msg: string): void },
  ) {}

  /** Yeni ölçüm; dakika dolduysa özetini dosyaya ekler. Testler için bittiğinde çözülen söz döner. */
  add(sample: HostNetSample, now = sample.at): Promise<void> {
    const minute = this.summarizer.push(sample);
    if (!minute || !this.dir) return this.queue;
    const dir = this.dir;
    const file = path.join(dir, `network-${dayKey(minute.at, this.offsetMin)}.jsonl`);
    const cleanup = now - this.lastCleanup > 6 * 3_600_000;
    if (cleanup) this.lastCleanup = now;
    this.queue = this.queue
      .then(async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.appendFile(file, JSON.stringify(minute) + '\n');
        if (cleanup) await this.removeOldFiles(now);
      })
      .catch((err: unknown) => {
        if (!this.warned) this.log?.warn({ err: String(err) }, 'ağ dakikalık özeti kaydedilemedi');
        this.warned = true;
      });
    return this.queue;
  }

  async removeOldFiles(now = Date.now()): Promise<void> {
    if (!this.dir) return;
    const oldest = dayKey(now - (this.retentionDays - 1) * 86_400_000, this.offsetMin);
    const names = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      const m = FILE.exec(name);
      if (m && m[1]! < oldest) await fs.promises.rm(path.join(this.dir, name), { force: true }).catch(() => undefined);
    }
  }
}
