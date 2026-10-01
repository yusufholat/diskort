import fs from 'node:fs';
import path from 'node:path';
import type { ProbeOutage } from './netProbe.js';

// Bağlantı teşhisi: kısa kesintilerin kaydı. İki bağımsız işaret birleştirilir:
//  - "sonda" kesintisi (netProbe.ts): sunucudan dışarıya art arda sondalar yanıtsız (≥2 farklı hedef),
//  - "NIC sessizliği" (aşağıda): sunucuya gelen paket hızı taban çizgisine göre çöküp sonra geri geliyor.
// İkisi aynı anda görülürse sunucuya hiçbir şey ulaşmamıştır (tam kesinti: sağlayıcı/hipervizör ağı). Yalnızca
// NIC sessizliği: gelen yön (ya da istemciler göndermeyi kesti). Yalnızca sonda: dış yol kesik ama NIC'e paket
// gelmeye devam etmiş (ya da trafik dedektörün çalışamayacağı kadar azdı).
// Kayıt: <dataDir>/telemetry/outages.jsonl (çalışırken kırpılır; 14 gün). Saatler istatistik saat dilimiyle
// (STATS_UTC_OFFSET_MIN) okunaklı olarak da yazılır.

/** NIC sessizliği: gelen paket hızı çöktü ve geri geldi */
export interface NicSilence {
  /** Çöküşün başladığı an (ms; saniye çözünürlüğünde) */
  at: number;
  durationMs: number;
  /** Sessizlik sırasındaki en düşük ve öncesindeki (10 sn ortanca) paket/sn */
  rxpMin: number;
  baseline: number;
  /** O an sesteki kişi sayısı (bilinmiyorsa null) */
  participants: number | null;
}

/** tam: ikisi birden · gelen: yalnızca NIC sessizliği · sonda: yalnızca dış sondalar */
export type OutageKind = 'tam' | 'gelen' | 'sonda';

export const OUTAGE_KIND_LABELS: Record<OutageKind, string> = {
  tam: 'tam kesinti',
  gelen: 'yalnız gelen',
  sonda: 'yalnız sonda',
};

export interface Outage {
  id: string;
  at: number;
  durationMs: number;
  /** Başlangıcın yerel saati, ör. "2026-10-01 01:23:47.200 +03:00" */
  t: string;
  kind: OutageKind;
  probe: ProbeOutage | null;
  nic: NicSilence | null;
}

/** ms → "YYYY-AA-GG SS:DD:SN.mmm +03:00" (verilen saat dilimiyle) */
export function localStamp(ms: number, offsetMin: number): string {
  const iso = new Date(ms + offsetMin * 60_000).toISOString();
  const abs = Math.abs(offsetMin);
  const zone = `${offsetMin < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)} ${zone}`;
}

// ---------- NIC sessizliği dedektörü (saf; saniyelik satırlarla sırayla beslenir) ----------

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Taban çizgisi için bakılan saniye sayısı ve en az gereken örnek */
const BASELINE_ROWS = 10;
const BASELINE_MIN_ROWS = 5;
/** Sessizlik eşiği: taban çizgisinin bu oranının altı; mutlak alt ve üst sınırla (paket/sn) */
const SILENCE_RATIO = 0.2;
const SILENCE_FLOOR_MIN = 10;
const SILENCE_FLOOR_MAX = 400;
/** Dedektörün çalışması için gereken taban çizgisi (paket/sn): seste biri varken / yokken */
const BASELINE_MIN_WITH_VOICE = 20;
const BASELINE_MIN_IDLE = 40;
/** Geri gelme: sessizlik bittikten sonra bu kadar saniye içinde taban çizgisinin yarısına dönmeli */
const RECOVERY_RATIO = 0.5;
const RECOVERY_ROWS = 5;
/** Bundan uzun süren "sessizlik" kesinti değil seviye değişimidir (yayın bitti, herkes çıktı) */
const MAX_SILENCE_ROWS = 60;
/**
 * Sesteki kişi ya da yayın sayısı azaldıktan sonraki bu süre içinde başlayan çöküş kesinti sayılmaz: trafik
 * birinin çıkması / yayını kapatması yüzünden azalmıştır (kısa süre sonra yeniden yayın açılsa bile).
 */
const VOICE_CHANGE_MS = 3_000;

interface SilenceState {
  start: number;
  end: number;
  rows: number;
  min: number;
  baseline: number;
  threshold: number;
  participants: number | null;
  /** Sessizlik bitti, geri gelme bekleniyor: geçen saniye */
  waited: number | null;
}

/** Sessizlik eşiği (paket/sn) */
export function silenceThreshold(baseline: number): number {
  return Math.min(SILENCE_FLOOR_MAX, Math.max(SILENCE_FLOOR_MIN, baseline * SILENCE_RATIO));
}

export class NicSilenceDetector {
  private history: number[] = [];
  private cur: SilenceState | null = null;
  private lastLoad: { participants: number; streams: number } | null = null;
  private loadDroppedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly onSilence: (s: NicSilence) => void) {}

  private reset(): void {
    this.history = [];
    this.cur = null;
  }

  private remember(rxp: number): void {
    this.history.push(rxp);
    if (this.history.length > BASELINE_ROWS) this.history.shift();
  }

  /**
   * Bir saniyelik ölçüm (t: satırın anı, rxp: gelen paket/sn, intervalMs: satırın kapsadığı süre).
   * Dönen değer: bu saniye sessizlik (adayı) mı. `corroborated`: aynı saniyede dış sonda da yanıtsız kaldıysa
   * tek saniyelik sessizlik de sayılır. `streams`: o anki yayın sayısı (biliniyorsa).
   */
  push(t: number, rxp: number | null, participants: number | null, corroborated = false, intervalMs = 1000, streams: number | null = null): boolean {
    if (rxp === null) {
      this.reset();
      return false;
    }
    // Sesteki kişi / yayın sayısı azaldı mı (trafiğin olağan nedenle azalması)
    if (participants !== null) {
      const load = { participants, streams: streams ?? 0 };
      if (this.lastLoad && (load.participants < this.lastLoad.participants || load.streams < this.lastLoad.streams)) this.loadDroppedAt = t;
      this.lastLoad = load;
    }
    const voiceChanged = t - this.loadDroppedAt <= VOICE_CHANGE_MS;
    if (voiceChanged && this.cur && this.cur.waited === null && this.cur.rows <= VOICE_CHANGE_MS / 1000) {
      // Çöküş başladıktan hemen sonra birinin çıktığı / yayını kapattığı öğrenildi: kesinti değil
      this.reset();
      this.remember(rxp);
      return false;
    }
    const cur = this.cur;
    if (cur && cur.waited === null) {
      if (rxp < cur.threshold) {
        cur.rows++;
        cur.end = t;
        cur.min = Math.min(cur.min, rxp);
        if (corroborated) cur.rows = Math.max(cur.rows, 2);
        if (cur.rows > MAX_SILENCE_ROWS) {
          // Seviye değişimi: yeni taban çizgisi baştan kurulur
          this.reset();
          this.remember(rxp);
          return false;
        }
        return true;
      }
      cur.waited = 0;
    }
    if (cur && cur.waited !== null) {
      if (rxp >= cur.baseline * RECOVERY_RATIO) {
        this.cur = null;
        // Düşük taban çizgisinde tek saniyelik dalgalanma gürültüdür: en az iki saniye (ya da sonda kaybıyla doğrulanmış)
        if (cur.rows >= (cur.baseline >= 100 ? 1 : 2)) {
          this.onSilence({
            at: cur.start,
            durationMs: Math.max(0, cur.end - cur.start),
            rxpMin: cur.min,
            baseline: Math.round(cur.baseline),
            participants: cur.participants,
          });
        }
        this.remember(rxp);
        return false;
      }
      if (rxp < cur.threshold) {
        // Yeniden çöktü: aynı sessizliğin devamı
        cur.rows += cur.waited + 1;
        cur.end = t;
        cur.min = Math.min(cur.min, rxp);
        cur.waited = null;
        return true;
      }
      if (++cur.waited >= RECOVERY_ROWS) {
        // Geri gelmedi: kesinti değil, trafik azaldı
        this.reset();
        this.remember(rxp);
      }
      return false;
    }
    if (this.history.length >= BASELINE_MIN_ROWS) {
      const baseline = median(this.history);
      const eligible = baseline >= ((participants ?? 0) >= 1 ? BASELINE_MIN_WITH_VOICE : BASELINE_MIN_IDLE);
      const threshold = silenceThreshold(baseline);
      if (eligible && rxp < threshold && voiceChanged) {
        // Seviye değişimi: taban çizgisi yeni trafikle baştan kurulur
        this.reset();
      } else if (eligible && rxp < threshold) {
        this.cur = {
          start: t - intervalMs,
          end: t,
          rows: corroborated ? 2 : 1,
          min: rxp,
          baseline,
          threshold,
          participants,
          waited: null,
        };
        return true;
      }
    }
    this.remember(rxp);
    return false;
  }

  /** Süren sessizlik (henüz geri gelmedi: aday); yoksa null */
  open(): { at: number; seconds: number; baseline: number; rxpMin: number } | null {
    const c = this.cur;
    return c && c.waited === null ? { at: c.start, seconds: c.rows, baseline: Math.round(c.baseline), rxpMin: c.min } : null;
  }
}

// ---------- Kayıt ----------

export interface OutageLogOptions {
  /** <dataDir>/telemetry; null: yalnızca bellekte */
  dir: string | null;
  offsetMin?: number;
  now?: () => number;
  log?: { warn(obj: object, msg: string): void };
  /** Kayıt dosyaya yazılmadan önce beklenen süre (ms): öbür işaret gelip birleşebilsin */
  settleMs?: number;
  maxFileLines?: number;
}

/** İki işaret bu kadar yakınsa (ms) aynı kesinti sayılır (NIC satırları saniye çözünürlüğündedir) */
const MERGE_SLACK_MS = 2_000;
const KEEP_MS = 14 * 86_400_000;
const MEMORY_MAX = 1_000;
const FILE_MAX_LINES = 2_000;

function isOutage(v: unknown): v is Outage {
  const o = v as Partial<Outage> | null;
  return !!o && typeof o.id === 'string' && typeof o.at === 'number' && typeof o.durationMs === 'number' && typeof o.kind === 'string';
}

export class OutageLog {
  private items: Outage[] = [];
  /** Henüz dosyaya yazılmamış kayıtlar ve son değiştikleri an */
  private readonly unsaved = new Map<string, number>();
  private fileLines = 0;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private warned = false;
  private readonly now: () => number;

  constructor(private readonly opts: OutageLogOptions) {
    this.now = opts.now ?? Date.now;
    this.load();
  }

  private get file(): string | null {
    return this.opts.dir ? path.join(this.opts.dir, 'outages.jsonl') : null;
  }

  private load(): void {
    const file = this.file;
    if (!file) return;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n').filter(Boolean);
    const since = this.now() - KEEP_MS;
    for (const line of lines) {
      try {
        const v = JSON.parse(line) as unknown;
        if (isOutage(v) && v.at >= since) this.items.push(v);
      } catch {
        // bozuk satır atlanır
      }
    }
    this.items = this.items.slice(-MEMORY_MAX);
    this.fileLines = lines.length;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), 5_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush(true);
  }

  private add(at: number, durationMs: number, part: { probe: ProbeOutage } | { nic: NicSilence }): Outage {
    const end = at + durationMs;
    const isProbe = 'probe' in part;
    // Öbür türden, zamanı çakışan ve bu türü henüz taşımayan kayıt varsa onunla birleşir
    const match = this.items.findLast(
      (o) => (isProbe ? o.probe === null : o.nic === null) && o.at - MERGE_SLACK_MS <= end && at - MERGE_SLACK_MS <= o.at + o.durationMs,
    );
    let o: Outage;
    if (match) {
      o = match;
      const from = Math.min(o.at, at);
      o.durationMs = Math.max(o.at + o.durationMs, end) - from;
      o.at = from;
      if (isProbe) o.probe = part.probe;
      else o.nic = part.nic;
    } else {
      o = {
        id: `${at.toString(36)}-${(this.seq++).toString(36)}`,
        at,
        durationMs,
        t: '',
        kind: 'sonda',
        probe: isProbe ? part.probe : null,
        nic: isProbe ? null : part.nic,
      };
      this.items.push(o);
      if (this.items.length > MEMORY_MAX) this.items.splice(0, this.items.length - MEMORY_MAX);
    }
    o.kind = o.probe && o.nic ? 'tam' : o.nic ? 'gelen' : 'sonda';
    o.t = localStamp(o.at, this.opts.offsetMin ?? 180);
    if (this.file) this.unsaved.set(o.id, this.now());
    return o;
  }

  addProbe(p: ProbeOutage): Outage {
    return this.add(p.at, p.durationMs, { probe: p });
  }

  addNic(s: NicSilence): Outage {
    return this.add(s.at, s.durationMs, { nic: s });
  }

  /** Durulmuş kayıtları dosyaya ekler (all: hepsini). Sınır aşılınca dosya bellekteki listeyle yeniden yazılır. */
  flush(all = false): Promise<void> {
    const file = this.file;
    if (!file || this.unsaved.size === 0) return this.writing;
    const now = this.now();
    const settle = this.opts.settleMs ?? 8_000;
    const ready: Outage[] = [];
    for (const [id, changedAt] of this.unsaved) {
      if (!all && now - changedAt < settle) continue;
      this.unsaved.delete(id);
      const o = this.items.find((x) => x.id === id);
      if (o) ready.push(o);
    }
    if (ready.length === 0) return this.writing;
    this.fileLines += ready.length;
    const trim = this.fileLines > (this.opts.maxFileLines ?? FILE_MAX_LINES);
    let snapshot: string | null = null;
    if (trim) {
      const since = now - KEEP_MS;
      const pending = new Set(this.unsaved.keys());
      const kept = this.items.filter((o) => o.at >= since && !pending.has(o.id));
      this.fileLines = kept.length;
      snapshot = kept.map((o) => JSON.stringify(o)).join('\n') + '\n';
    }
    const lines = ready.map((o) => JSON.stringify(o)).join('\n') + '\n';
    this.writing = this.writing
      .then(async () => {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (snapshot !== null) await fs.promises.writeFile(file, snapshot);
        else await fs.promises.appendFile(file, lines);
      })
      .catch((err: unknown) => {
        if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'kesinti kaydı yazılamadı');
        this.warned = true;
      });
    return this.writing;
  }

  /** En yeniler önce */
  list(since: number): Outage[] {
    return this.items.filter((o) => o.at + o.durationMs >= since).sort((a, b) => b.at - a.at);
  }

  /** [from, to] aralığıyla kesişenler, eskiden yeniye */
  between(from: number, to: number): Outage[] {
    return this.items.filter((o) => o.at <= to && o.at + o.durationMs >= from).sort((a, b) => a.at - b.at);
  }
}
