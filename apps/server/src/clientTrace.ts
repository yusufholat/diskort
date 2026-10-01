import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import {
  VOICE_TRACE_MAX_MARKS,
  VOICE_TRACE_MAX_SAMPLES,
  type ClientPlatform,
  type VoiceTraceMark,
  type VoiceTraceSample,
  type VoiceTraceUpload,
} from '@diskort/shared';
import { dayKey } from './counters.js';

// Olay kayıtları (bkz. shared/voiceTrace.ts ve client-core voiceTrace.ts): istemcilerin sorun anındaki
// saniyelik bağlantı ölçümleri. Sunucu:
// - gövdeyi doğrular ve sınırlar (ölçüm sayısı, alan aralıkları, gövde boyutu rotada),
// - istemci saatindeki ölçümleri kendi saatine çevirecek farkı belirler (istemcinin ölçtüğü fark, yoksa ya da
//   tutarsızsa gönderim anından tahmin),
// - her kaydı günlük JSONL dosyasına ekler (<dataDir>/telemetry/traces-YYYY-AA-GG.jsonl; 14 gün, gün başına
//   boyut sınırlı). Klasör yoksa (SYSTEM_STATS kapalı, testler) son kayıtlar yalnızca bellekte tutulur.
// Satırda önce özet alanlar, en sonda `samples` vardır: liste okunurken ölçümler ayrıştırılmaz.

const clamp =
  (min: number, max: number) =>
  (v: number): number =>
    Math.min(max, Math.max(min, v));
/** Sayaç / ölçüm: sonlu sayı, aralığa sıkıştırılır; bilinmiyorsa null ya da hiç yok */
const num = (max = 1e12) => z.number().finite().transform(clamp(0, max)).nullable().optional();
const short = (max: number) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .nullable()
    .optional();
/** İstemci saati (Unix ms): 2001–2286 arası */
const clock = z.number().finite().min(1e12).max(1e13);

const upSchema = z.object({
  k: z.enum(['mic', 'scr', 'sau', 'a', 'v']),
  ps: z.number().finite().transform(clamp(0, 1e9)),
  bs: z.number().finite().transform(clamp(0, 1e12)),
  pl: num(1e9),
  fl: num(100),
  rr: num(100),
  rtt: num(600_000),
  jt: num(600_000),
  tb: num(1e11),
  fe: num(1e6),
  fs: num(1e6),
  kf: num(1e6),
  hf: num(1e6),
  nk: num(1e9),
  pli: num(1e6),
  fir: num(1e6),
  rb: num(1e12),
  rp: num(1e9),
  ql: short(16),
  w: num(20_000),
  h: num(20_000),
  fps: num(1_000),
  em: num(60_000),
  sd: num(1e9),
});

const transportSchema = z.object({
  pi: z.number().int().min(0).max(1e6),
  pch: z.literal(1).optional(),
  rtt: num(600_000),
  sq: num(1e6),
  sr: num(1e6),
  su: z.number().finite().transform(clamp(0, 3_600_000)),
  ao: num(1e11),
  ai: num(1e11),
  bs: num(1e12),
  br: num(1e12),
  pd: num(1e9),
  ice: short(16),
  pc: short(16),
  lk: short(16),
  ct: short(16),
  pr: short(16),
});

const downAudioSchema = z.object({
  n: z.number().int().min(0).max(1_000),
  pr: z.number().finite().transform(clamp(0, 1e9)),
  pl: z.number().finite().transform(clamp(0, 1e9)),
  bs: z.number().finite().transform(clamp(0, 1e12)),
  j: num(600_000),
  ss: num(1e10),
  cs: num(1e10),
  ce: num(1e6),
});

const downVideoSchema = z.object({
  i: z.number().int().min(0).max(1e6),
  pr: z.number().finite().transform(clamp(0, 1e9)),
  pl: num(1e9),
  bs: z.number().finite().transform(clamp(0, 1e12)),
  j: num(600_000),
  fd: num(1e6),
  kf: num(1e6),
  fz: num(1e6),
  fzd: num(3_600_000),
  dr: num(1e6),
  pdc: num(1e9),
  nk: num(1e9),
  pli: num(1e6),
  jb: num(600_000),
  fps: num(1_000),
  w: num(20_000),
  h: num(20_000),
});

const sampleSchema = z.object({
  q: z.number().int().min(0).max(1e12),
  t: clock,
  dt: z.number().finite().transform(clamp(0, 600_000)),
  x: transportSchema.nullable(),
  up: z.array(upSchema).max(8),
  da: downAudioSchema.nullable().optional(),
  dv: z.array(downVideoSchema).max(8).optional(),
  lag: num(3_600_000),
  un: num(1e9),
});

export const traceUploadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  platform: z.enum(['desktop', 'android', 'ios']),
  version: z.string().max(32),
  channelId: z.string().max(64),
  reason: z.string().max(48),
  reasons: z.array(z.string().max(48)).max(16),
  eventId: z.string().max(64).nullable(),
  triggerAt: clock,
  sentAt: clock,
  offsetMs: z.number().finite().nullable(),
  attempt: z.number().int().min(1).max(1_000),
  more: z.boolean(),
  intervalMs: z.number().finite().transform(clamp(0, 60_000)),
  samples: z.array(sampleSchema).min(1).max(VOICE_TRACE_MAX_SAMPLES),
  marks: z.array(z.object({ t: clock, l: z.string().max(64) })).max(VOICE_TRACE_MAX_MARKS),
});

/** Kaydın özeti (liste uçları yalnızca bunu döner) */
export interface TraceMeta {
  /** Sunucunun verdiği kimlik */
  id: string;
  /** Sunucuya ulaştığı an */
  at: number;
  userId: string;
  channelId: string | null;
  guildId: string | null;
  platform: ClientPlatform;
  version: string;
  /** İstemcinin kesit kimliği (yeniden denemede aynı) */
  clientId: string;
  reason: string;
  reasons: string[];
  eventId: string | null;
  /** Tetikleme anı ve ölçümlerin kapsadığı aralık — SUNUCU saatiyle (istemci saati + offsetMs) */
  triggerAt: number;
  from: number;
  to: number;
  /** Uygulanan saat farkı (sunucu − istemci, ms) ve kaynağı: istemcinin ölçümü ya da gönderim anından tahmin */
  offsetMs: number;
  offsetSource: 'client' | 'sentAt';
  /** Tetiklemeden sunucuya ulaşana kadar geçen süre (ms) ve deneme sayısı */
  delayMs: number;
  attempt: number;
  more: boolean;
  intervalMs: number;
  /** Ölçüm sayısı */
  n: number;
}

/** Saklanan kayıt: ölçümler istemci saatiyle (`t`), okurken `ts` (sunucu saati) eklenir */
export interface StoredTrace extends TraceMeta {
  marks: VoiceTraceMark[];
  samples: VoiceTraceSample[];
}

/** Okunan kayıt: her ölçüm ve işarette sunucu saatine çevrilmiş an (`ts`) */
export interface AlignedTrace extends TraceMeta {
  marks: (VoiceTraceMark & { ts: number })[];
  samples: (VoiceTraceSample & { ts: number })[];
}

export interface TraceQuery {
  from: number;
  to: number;
  channelId?: string;
  userId?: string;
  eventId?: string;
  limit?: number;
}

export interface ClientTraceStoreOptions {
  /** JSONL klasörü; null: yalnızca bellekte (testler, SYSTEM_STATS kapalı) */
  dir: string | null;
  retentionDays?: number;
  /** Bir günün dosyasının en büyük boyutu (bayt); aşılırsa o günün kalan kayıtları yazılmaz */
  maxDayBytes?: number;
  /** Günlerin saat dilimi (dk) */
  offsetMin?: number;
  /** Klasör yokken bellekte tutulan en fazla kayıt */
  memoryMax?: number;
  /**
   * Bir kullanıcının bir günde saklanan kayıtlarının en büyük toplam boyutu (bayt) ve sayısı: tek hesap
   * günlük dosya payının tamamını tüketemesin. Aşan kayıtlar saklanmaz (sunucu yeniden başlayınca sayım sıfırlanır).
   */
  maxUserDayBytes?: number;
  maxUserDayCount?: number;
  log?: { warn(obj: object, msg: string): void };
}

/** İstemcinin ölçtüğü fark, gönderim anından tahminle bu kadardan fazla ayrışıyorsa güvenilmez */
const OFFSET_TOLERANCE_MS = 30_000;
/** Aynı kesitin yeniden gönderimi bu süre içinde tanınır */
const DEDUPE_MS = 15 * 60_000;
const CLEANUP_INTERVAL_MS = 6 * 3_600_000;
/** Sorgularda kabul edilen en büyük an (Unix ms; ~2096): ötesi tarih hesabını bozar */
export const TRACE_TIME_MAX = 4e12;
const validTime = (t: number): boolean => Number.isFinite(t) && t >= 0 && t <= TRACE_TIME_MAX;
const SAMPLES_KEY = ',"samples":[';
const FILE_RE = /^traces-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export class ClientTraceStore {
  private buffer: string[] = [];
  private memory: string[] = [];
  private readonly dayBytes = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private warned = false;
  private seq = 0;
  private lastCleanup = 0;
  /** Gün → kullanıcı → o gün saklanan kayıtların boyutu ve sayısı (kullanıcı başına günlük pay) */
  private readonly userDay = new Map<string, Map<string, { bytes: number; count: number }>>();
  /**
   * Sunucu açıldığından beri alınan / yinelenen / günlük dosya sınırı yüzünden yazılmayan / kullanıcının
   * günlük payını aştığı için saklanmayan kayıtlar
   */
  received = 0;
  duplicates = 0;
  dropped = 0;
  overBudget = 0;
  private readonly maxUserDayBytes: number;
  private readonly maxUserDayCount: number;
  readonly retentionDays: number;
  private readonly maxDayBytes: number;
  private readonly offsetMin: number;
  private readonly memoryMax: number;

  constructor(private readonly opts: ClientTraceStoreOptions) {
    this.retentionDays = opts.retentionDays ?? 14;
    this.maxDayBytes = opts.maxDayBytes ?? 48 * 1024 * 1024;
    this.offsetMin = opts.offsetMin ?? 180;
    this.memoryMax = opts.memoryMax ?? 100;
    this.maxUserDayBytes = opts.maxUserDayBytes ?? 6 * 1024 * 1024;
    this.maxUserDayCount = opts.maxUserDayCount ?? 400;
  }

  private file(day: string): string {
    return path.join(this.opts.dir!, `traces-${day}.jsonl`);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), 10_000);
    this.timer.unref();
    this.lastCleanup = Date.now();
    void this.removeOldFiles();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private async sweep(now = Date.now()): Promise<void> {
    await this.flush();
    for (const [key, at] of this.seen) if (now - at > DEDUPE_MS) this.seen.delete(key);
    if (now - this.lastCleanup >= CLEANUP_INTERVAL_MS) {
      this.lastCleanup = now;
      await this.removeOldFiles(now);
    }
  }

  /**
   * Yeni kayıt (rota doğrulamasından sonra). Aynı kesit daha önce alındıysa (yeniden deneme; yanıt
   * istemciye ulaşmamış olabilir) ya da kullanıcı günlük payını aştıysa null döner, kaydedilmez.
   */
  ingest(
    userId: string,
    upload: VoiceTraceUpload,
    where: { channelId: string | null; guildId: string | null },
    now = Date.now(),
  ): TraceMeta | null {
    const key = `${userId}:${upload.id}`;
    if (this.seen.has(key)) {
      this.duplicates++;
      return null;
    }
    this.seen.set(key, now);
    this.received++;

    // Saat farkı: gönderim anından tahmin, yükleme süresi kadar fazla çıkar (üst sınır). İstemcinin ölçümü
    // daha kesindir; onunla tutarlıysa o kullanılır. Hiçbir ölçüm sunucunun "şimdi"sinden ileride olamaz.
    const estimated = now - upload.sentAt;
    const client = upload.offsetMs;
    const useClient = client !== null && Math.abs(client - estimated) <= OFFSET_TOLERANCE_MS;
    const last = upload.samples[upload.samples.length - 1]!.t;
    let offsetMs = Math.round(useClient ? client : estimated);
    if (last + offsetMs > now) offsetMs = now - last;
    const first = upload.samples[0]!;
    const meta: TraceMeta = {
      id: `${now.toString(36)}-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: now,
      userId,
      channelId: where.channelId,
      guildId: where.guildId,
      platform: upload.platform,
      version: upload.version,
      clientId: upload.id,
      reason: upload.reason,
      reasons: upload.reasons,
      eventId: upload.eventId,
      triggerAt: upload.triggerAt + offsetMs,
      from: first.t - first.dt + offsetMs,
      to: last + offsetMs,
      offsetMs,
      offsetSource: useClient ? 'client' : 'sentAt',
      delayMs: Math.max(0, now - (upload.triggerAt + offsetMs)),
      attempt: upload.attempt,
      more: upload.more,
      intervalMs: upload.intervalMs,
      n: upload.samples.length,
    };
    // `samples` en sonda: liste okunurken satır buradan kesilir
    const stored: StoredTrace = { ...meta, marks: upload.marks, samples: upload.samples };
    const line = JSON.stringify(stored);
    // Kullanıcı başına günlük pay
    const day = dayKey(now, this.offsetMin);
    let users = this.userDay.get(day);
    if (!users) {
      // Yeni gün: eski günlerin sayımı bırakılır
      for (const d of this.userDay.keys()) if (d < day) this.userDay.delete(d);
      users = new Map();
      this.userDay.set(day, users);
    }
    const used = users.get(userId) ?? { bytes: 0, count: 0 };
    const bytes = Buffer.byteLength(line) + 1;
    if (used.count + 1 > this.maxUserDayCount || used.bytes + bytes > this.maxUserDayBytes) {
      this.overBudget++;
      return null;
    }
    users.set(userId, { bytes: used.bytes + bytes, count: used.count + 1 });
    if (this.opts.dir) {
      this.buffer.push(line);
    } else {
      this.memory.push(line);
      if (this.memory.length > this.memoryMax) this.memory.shift();
    }
    return meta;
  }

  /** Bekleyen satırları günlük dosyalara ekler (gün başına boyut sınırıyla) */
  flush(): Promise<void> {
    if (!this.opts.dir || this.buffer.length === 0) return Promise.resolve();
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const dir = this.opts.dir!;
    const lines = this.buffer;
    this.buffer = [];
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const byDay = new Map<string, string[]>();
      for (const line of lines) {
        const at = Number(/"at":(\d+)/.exec(line)?.[1] ?? Date.now());
        const day = dayKey(at, this.offsetMin);
        const list = byDay.get(day);
        if (list) list.push(line);
        else byDay.set(day, [line]);
      }
      for (const [day, dayLines] of byDay) {
        let size = this.dayBytes.get(day);
        if (size === undefined) size = (await fs.promises.stat(this.file(day)).catch(() => null))?.size ?? 0;
        const kept: string[] = [];
        for (const line of dayLines) {
          const bytes = Buffer.byteLength(line) + 1;
          if (size + bytes > this.maxDayBytes) {
            this.dropped++;
            continue;
          }
          size += bytes;
          kept.push(line);
        }
        this.dayBytes.set(day, size);
        if (kept.length > 0) await fs.promises.appendFile(this.file(day), kept.join('\n') + '\n');
      }
    } catch (err) {
      if (!this.warned) this.opts.log?.warn({ err: String(err) }, 'olay kayıtları kaydedilemedi');
      this.warned = true;
    }
  }

  /** Saklama süresini aşan günlük dosyaları siler */
  async removeOldFiles(now = Date.now()): Promise<void> {
    if (!this.opts.dir) return;
    const oldest = dayKey(now - (this.retentionDays - 1) * 86_400_000, this.offsetMin);
    const names = await fs.promises.readdir(this.opts.dir).catch(() => [] as string[]);
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (m && m[1]! < oldest) await fs.promises.rm(path.join(this.opts.dir, name), { force: true }).catch(() => undefined);
    }
    for (const day of this.dayBytes.keys()) if (day < oldest) this.dayBytes.delete(day);
  }

  // ---------- Okuma ----------

  /** Gün listesi (dosyası olan, yeniden eskiye) */
  async days(): Promise<{ day: string; size: number }[]> {
    if (!this.opts.dir) return [];
    const names = await fs.promises.readdir(this.opts.dir).catch(() => [] as string[]);
    const out: { day: string; size: number }[] = [];
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      const st = await fs.promises.stat(path.join(this.opts.dir, name)).catch(() => null);
      if (st) out.push({ day: m[1]!, size: st.size });
    }
    return out.sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  /** Aralıkla ilgili satırlar (dosyalardan ya da bellekten), eskiden yeniye */
  private async *lines(from: number, to: number): AsyncGenerator<string> {
    // Geçersiz ya da ters aralık: kayıt yok (tarih hesabı aralık dışı sayıda hata verir)
    if (!validTime(from) || !validTime(to) || from > to) return;
    // Saklama süresinden eski gün dosyası olamaz: taranacak gün sayısı sınırlı kalır
    from = Math.max(from, to - (this.retentionDays + 1) * 86_400_000);
    if (!this.opts.dir) {
      yield* this.memory;
      return;
    }
    await this.flush();
    // Kayıt, kapsadığı aralıktan sonra ulaşır (en çok ~7 dk); günü ulaştığı ana göredir
    const days = new Set<string>();
    for (let t = from; t <= to + 3_600_000; t += 3_600_000) days.add(dayKey(t, this.offsetMin));
    days.add(dayKey(to + 3_600_000, this.offsetMin));
    for (const day of [...days].sort()) {
      const file = this.file(day);
      if (!fs.existsSync(file)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
      try {
        for await (const line of rl) if (line) yield line;
      } finally {
        rl.close();
      }
    }
  }

  private static metaOf(line: string): TraceMeta | null {
    const cut = line.indexOf(SAMPLES_KEY);
    try {
      const v = JSON.parse(cut === -1 ? line : `${line.slice(0, cut)}}`) as TraceMeta & { marks?: unknown };
      if (typeof v.id !== 'string' || typeof v.userId !== 'string' || typeof v.from !== 'number' || typeof v.to !== 'number') return null;
      delete v.marks;
      return v;
    } catch {
      return null;
    }
  }

  private static matches(m: TraceMeta, q: TraceQuery): boolean {
    if (m.to < q.from || m.from > q.to) return false;
    if (q.channelId !== undefined && m.channelId !== q.channelId) return false;
    if (q.userId !== undefined && m.userId !== q.userId) return false;
    if (q.eventId !== undefined && m.eventId !== q.eventId) return false;
    return true;
  }

  private static align(line: string): AlignedTrace | null {
    try {
      const t = JSON.parse(line) as StoredTrace;
      return {
        ...t,
        marks: (t.marks ?? []).map((m) => ({ ...m, ts: m.t + t.offsetMs })),
        samples: (t.samples ?? []).map((s) => ({ ...s, ts: s.t + t.offsetMs })),
      };
    } catch {
      return null;
    }
  }

  /** Kayıtların özetleri (ölçümler olmadan), yeniden eskiye */
  async list(q: TraceQuery): Promise<{ traces: TraceMeta[]; truncated: boolean }> {
    const limit = Math.min(1_000, Math.max(1, q.limit ?? 200));
    // Tarama sırasında yalnızca en yeni `limit` özet tutulur (bellek, eşleşen kayıt sayısıyla büyümez)
    let top: TraceMeta[] = [];
    let truncated = false;
    const newestFirst = (a: TraceMeta, b: TraceMeta): number => b.to - a.to;
    for await (const line of this.lines(q.from, q.to)) {
      if (q.userId !== undefined && !line.includes(`"userId":${JSON.stringify(q.userId)}`)) continue;
      const meta = ClientTraceStore.metaOf(line);
      if (!meta || !ClientTraceStore.matches(meta, q)) continue;
      top.push(meta);
      if (top.length >= limit * 2) {
        top = top.sort(newestFirst).slice(0, limit);
        truncated = true;
      }
    }
    top.sort(newestFirst);
    if (top.length > limit) truncated = true;
    return { traces: top.slice(0, limit), truncated };
  }

  /**
   * Aralıkla kesişen kayıtların tamamı; ölçümler aralığa kırpılır ve sunucu saatine çevrilmiş anlarıyla
   * (`ts`) döner. Aynı saniyelere farklı istemcilerin gözünden bakmak için.
   */
  async window(q: TraceQuery): Promise<{ traces: AlignedTrace[]; truncated: boolean }> {
    const limit = Math.min(100, Math.max(1, q.limit ?? 50));
    const out: AlignedTrace[] = [];
    let truncated = false;
    for await (const line of this.lines(q.from, q.to)) {
      if (q.userId !== undefined && !line.includes(`"userId":${JSON.stringify(q.userId)}`)) continue;
      const meta = ClientTraceStore.metaOf(line);
      if (!meta || !ClientTraceStore.matches(meta, q)) continue;
      if (out.length >= limit) {
        truncated = true;
        break;
      }
      const full = ClientTraceStore.align(line);
      if (!full) continue;
      full.samples = full.samples.filter((s) => s.ts >= q.from && s.ts - s.dt < q.to);
      full.marks = full.marks.filter((m) => m.ts >= q.from && m.ts <= q.to);
      out.push(full);
    }
    out.sort((a, b) => a.from - b.from);
    return { traces: out, truncated };
  }

  /** Tek kayıt (kimliğiyle); kimlik ulaştığı anı taşır, yalnızca o günün dosyasına bakılır */
  async get(id: string): Promise<AlignedTrace | null> {
    const at = parseInt(id.split('-')[0] ?? '', 36);
    if (!validTime(at)) return null;
    const needle = `{"id":${JSON.stringify(id)},`;
    for await (const line of this.lines(at, at)) {
      if (line.startsWith(needle)) return ClientTraceStore.align(line);
    }
    return null;
  }
}
