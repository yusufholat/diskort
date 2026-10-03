import { readJsonSync, writeJsonAtomic } from './systemStats.js';
// (systemStats.ts bu dosyayı yalnızca tür olarak kullanır; SystemHistory app.ts'te kurulup SystemMonitor'a verilir)

// Makine yükünün uzun geçmişi (yönetim paneli, "24 saat / 7 gün" grafikleri): 5 dakikalık kovalarda CPU,
// kullanılan bellek ve NIC hızının ortalaması ve en yükseği, 7 gün. Kısa geçmiş (son dakikalar) SystemMonitor'da
// ayrıca tutulur. Kova kapandıkça <dataDir>/system-history.json'a yazılır (en çok 2016 kova, ~150 KB); kapanışta
// açık kova da yazılır, açılışta aynı kovaya gelen ölçümler onunla birleşir. Sunucunun kapalı olduğu aralıkta
// kova yoktur: grafik orada boşluk gösterir.

export const HISTORY_BUCKET_MS = 5 * 60_000;
export const HISTORY_KEEP_MS = 7 * 86_400_000;
/** Tutulan en fazla kova (7 gün × 288) */
export const HISTORY_MAX_BUCKETS = HISTORY_KEEP_MS / HISTORY_BUCKET_MS;

/** Bir kova; ölçüm yoksa değerler null */
export interface HistoryBucket {
  /** Kovanın başlangıcı (ms) */
  at: number;
  /** Kovadaki ölçüm sayısı (birleştirmede ağırlık) */
  n: number;
  /** CPU kullanımı 0..1 */
  cpu: number | null;
  cpuMax: number | null;
  /** Kullanılan bellek (bayt) */
  mem: number | null;
  memMax: number | null;
  /** NIC hızı (Mbit/sn; saniyelik ölçümlerin ortalaması ve en yükseği) */
  rx: number | null;
  rxMax: number | null;
  tx: number | null;
  txMax: number | null;
}

/** Dosyadaki biçim: kovalar dizi olarak (dosya küçük kalsın) */
type BucketRow = [number, number, ...(number | null)[]];
interface HistoryFile {
  v: 1;
  bucketMs: number;
  buckets: BucketRow[];
}

const METRICS = ['cpu', 'mem', 'rx', 'tx'] as const;
type Metric = (typeof METRICS)[number];

const toRow = (b: HistoryBucket): BucketRow => [b.at, b.n, b.cpu, b.cpuMax, b.mem, b.memMax, b.rx, b.rxMax, b.tx, b.txMax];

function fromRow(row: unknown): HistoryBucket | null {
  if (!Array.isArray(row) || row.length !== 10) return null;
  const ok = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
  if (typeof row[0] !== 'number' || typeof row[1] !== 'number' || row[1] < 1 || !row.every(ok)) return null;
  const [at, n, cpu, cpuMax, mem, memMax, rx, rxMax, tx, txMax] = row as (number | null)[];
  return { at: at!, n: n!, cpu: cpu!, cpuMax: cpuMax!, mem: mem!, memMax: memMax!, rx: rx!, rxMax: rxMax!, tx: tx!, txMax: txMax! };
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const DIGITS: Record<Metric, number> = { cpu: 4, mem: 0, rx: 2, tx: 2 };

/**
 * Kovaları birleştirir (aynı kova yeniden açıldıysa ya da uzun aralıkta seyreltirken): ortalamalar ölçüm
 * sayısıyla ağırlıklı, en yüksekler en yüksek. `at` ilk kovanınki.
 */
export function mergeBuckets(list: HistoryBucket[], at = list[0]?.at ?? 0): HistoryBucket {
  const out: HistoryBucket = { at, n: 0, cpu: null, cpuMax: null, mem: null, memMax: null, rx: null, rxMax: null, tx: null, txMax: null };
  for (const m of METRICS) {
    let sum = 0;
    let weight = 0;
    let max: number | null = null;
    for (const b of list) {
      const avg = b[m];
      if (avg !== null) {
        sum += avg * b.n;
        weight += b.n;
      }
      const top = b[`${m}Max`];
      if (top !== null) max = max === null ? top : Math.max(max, top);
    }
    out[m] = weight > 0 ? round(sum / weight, DIGITS[m]) : null;
    out[`${m}Max`] = max;
  }
  out.n = list.reduce((n, b) => n + b.n, 0);
  return out;
}

/** Bir ölçümün katkısı */
export interface HistoryInput {
  at: number;
  cpu: number | null;
  memUsed: number | null;
  /** Son ölçümden bu yana NIC'in saniyelik hızları (Mbit/sn) */
  net: { rx: number | null; tx: number | null }[];
}

class Acc {
  sum = 0;
  count = 0;
  max: number | null = null;
  add(v: number | null): void {
    if (v === null || !Number.isFinite(v)) return;
    this.sum += v;
    this.count++;
    this.max = this.max === null ? v : Math.max(this.max, v);
  }
}

interface OpenBucket {
  at: number;
  n: number;
  acc: Record<Metric, Acc>;
}

/** Saklanan kovaları dosya içeriğinden okur: bozuk satırlar ve 7 günden eskiler atılır, sıralanır, tekilleştirilir */
export function loadBuckets(value: unknown, now: number): HistoryBucket[] {
  const file = value as Partial<HistoryFile> | null;
  if (!file || file.v !== 1 || file.bucketMs !== HISTORY_BUCKET_MS || !Array.isArray(file.buckets)) return [];
  const byAt = new Map<number, HistoryBucket>();
  for (const row of file.buckets) {
    const b = fromRow(row);
    if (!b || b.at % HISTORY_BUCKET_MS !== 0 || b.at < now - HISTORY_KEEP_MS || b.at > now) continue;
    const prev = byAt.get(b.at);
    byAt.set(b.at, prev ? mergeBuckets([prev, b]) : b);
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at).slice(-HISTORY_MAX_BUCKETS);
}

export class SystemHistory {
  private buckets: HistoryBucket[];
  private open: OpenBucket | null = null;
  private dirty = false;
  private warned = false;

  constructor(
    private readonly file: string | null,
    now = Date.now(),
    private readonly log?: { warn(obj: object, msg: string): void },
  ) {
    this.buckets = loadBuckets(readJsonSync(file), now);
  }

  /** Ölçümü açık kovaya ekler; kova değiştiyse öncekini kapatır. Kova kapandıysa true (yazma zamanı). */
  add(input: HistoryInput): boolean {
    const at = Math.floor(input.at / HISTORY_BUCKET_MS) * HISTORY_BUCKET_MS;
    // Saat geriye gittiyse ölçüm atlanır (kovalar sıralı kalsın)
    if (this.open && at < this.open.at) return false;
    let closed = false;
    if (this.open && at !== this.open.at) {
      this.close(input.at);
      closed = true;
    }
    this.open ??= { at, n: 0, acc: { cpu: new Acc(), mem: new Acc(), rx: new Acc(), tx: new Acc() } };
    this.open.n++;
    this.open.acc.cpu.add(input.cpu);
    this.open.acc.mem.add(input.memUsed);
    for (const r of input.net) {
      this.open.acc.rx.add(r.rx);
      this.open.acc.tx.add(r.tx);
    }
    return closed;
  }

  private snapshotOpen(): HistoryBucket | null {
    const o = this.open;
    if (!o) return null;
    const b: HistoryBucket = { at: o.at, n: o.n, cpu: null, cpuMax: null, mem: null, memMax: null, rx: null, rxMax: null, tx: null, txMax: null };
    for (const m of METRICS) {
      const a = o.acc[m];
      b[m] = a.count > 0 ? round(a.sum / a.count, DIGITS[m]) : null;
      b[`${m}Max`] = a.max === null ? null : round(a.max, DIGITS[m]);
    }
    return b;
  }

  /** Açık kovayı kapatır: aynı başlangıçlı saklanan kova varsa (yeniden başlatma) onunla birleşir */
  private close(now: number): void {
    const b = this.snapshotOpen();
    this.open = null;
    if (!b) return;
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.at === b.at) this.buckets[this.buckets.length - 1] = mergeBuckets([last, b]);
    else if (!last || last.at < b.at) this.buckets.push(b);
    const cutoff = now - HISTORY_KEEP_MS;
    let drop = 0;
    while (drop < this.buckets.length && this.buckets[drop]!.at < cutoff) drop++;
    drop = Math.max(drop, this.buckets.length - HISTORY_MAX_BUCKETS);
    if (drop > 0) this.buckets.splice(0, drop);
    this.dirty = true;
  }

  /**
   * [from, to] aralığındaki kovalar (açık kova dahil), `stepMs`'lik kovalara seyreltilerek (5 dk'nın katı).
   * Kovası olmayan aralık yanıtta yoktur (boşluk).
   */
  range(from: number, to: number, stepMs = HISTORY_BUCKET_MS): HistoryBucket[] {
    const step = Math.max(HISTORY_BUCKET_MS, Math.round(stepMs / HISTORY_BUCKET_MS) * HISTORY_BUCKET_MS);
    const open = this.snapshotOpen();
    const last = this.buckets[this.buckets.length - 1];
    // Açık kova yeniden başlatmadan kalan kovayla aynıysa birleşik hâli gösterilir
    const all = !open
      ? this.buckets
      : last && last.at === open.at
        ? [...this.buckets.slice(0, -1), mergeBuckets([last, open])]
        : !last || open.at > last.at
          ? [...this.buckets, open]
          : this.buckets;
    const list = all.filter((b) => b.at + HISTORY_BUCKET_MS > from && b.at <= to);
    if (step === HISTORY_BUCKET_MS) return list.map((b) => ({ ...b }));
    const out: HistoryBucket[] = [];
    let group: HistoryBucket[] = [];
    let key = -1;
    for (const b of list) {
      const k = Math.floor(b.at / step) * step;
      if (k !== key && group.length > 0) {
        out.push(mergeBuckets(group, key));
        group = [];
      }
      key = k;
      group.push(b);
    }
    if (group.length > 0) out.push(mergeBuckets(group, key));
    return out;
  }

  /** Saklanan (kapanmış) kova sayısı */
  get size(): number {
    return this.buckets.length;
  }

  /** Değiştiyse dosyaya yazar. `final` (kapanış): açık kova da yazılır (yeniden açılışta birleşir). */
  async persist(final = false): Promise<void> {
    if (!this.file) return;
    const open = final ? this.snapshotOpen() : null;
    if (!this.dirty && !open) return;
    this.dirty = false;
    const rows = this.buckets.map(toRow);
    if (open) {
      const last = this.buckets[this.buckets.length - 1];
      if (last && last.at === open.at) rows[rows.length - 1] = toRow(mergeBuckets([last, open]));
      else rows.push(toRow(open));
    }
    const content: HistoryFile = { v: 1, bucketMs: HISTORY_BUCKET_MS, buckets: rows };
    try {
      await writeJsonAtomic(this.file, content);
    } catch (err) {
      if (!this.warned) this.log?.warn({ err: String(err) }, 'makine geçmişi kaydedilemedi');
      this.warned = true;
    }
  }
}
