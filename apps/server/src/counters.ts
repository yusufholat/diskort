import { readJsonSync, writeJsonAtomic } from './systemStats.js';

// Yönetim paneli için gün başına sayaçlar (bildirim gönderimleri, indirmeler, güncelleme denetimleri, girişler…).
// Bellekte tutulur, dakikada bir <dataDir>/counters.json'a yazılır; son COUNTER_DAYS gün saklanır. Günler
// sabit bir saat dilimine göredir (varsayılan UTC+3, Türkiye): sunucunun kendi saat dilimi önemli değildir.

export const COUNTER_DAYS = 30;
const DAY_MS = 86_400_000;
const PERSIST_INTERVAL_MS = 60_000;

interface CountersFile {
  v: 1;
  /** Gün (YYYY-AA-GG) → sayaç adı → değer */
  days: Record<string, Record<string, number>>;
  since: number;
}

function isCountersFile(value: unknown): value is CountersFile {
  const f = value as Partial<CountersFile> | null;
  return !!f && f.v === 1 && typeof f.since === 'number' && typeof f.days === 'object' && f.days !== null;
}

/** `offsetMin` dakika kaydırılmış saatle günün anahtarı (YYYY-AA-GG) */
export function dayKey(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);
}

export class DailyCounters {
  private days = new Map<string, Map<string, number>>();
  /** Sayımın başladığı an (dosya yoksa ilk açılış) */
  readonly since: number;
  private dirty = false;
  private lastPersist = 0;
  private warned = false;

  constructor(
    private readonly file: string | null,
    readonly offsetMin = 180,
    now = Date.now(),
    private readonly log?: { warn(obj: object, msg: string): void },
  ) {
    const saved = readJsonSync(file);
    if (isCountersFile(saved)) {
      this.since = saved.since;
      for (const [day, values] of Object.entries(saved.days)) {
        const map = new Map<string, number>();
        for (const [k, v] of Object.entries(values ?? {})) if (typeof v === 'number') map.set(k, v);
        this.days.set(day, map);
      }
    } else {
      this.since = now;
    }
  }

  inc(key: string, n = 1, now = Date.now()): void {
    const day = dayKey(now, this.offsetMin);
    let map = this.days.get(day);
    if (!map) {
      map = new Map();
      this.days.set(day, map);
      this.prune(now);
    }
    map.set(key, (map.get(key) ?? 0) + n);
    this.dirty = true;
  }

  /** Son `days` günün toplamı (bugün dahil) */
  sum(key: string, days: number, now = Date.now()): number {
    let total = 0;
    for (const day of this.dayKeys(days, now)) total += this.days.get(day)?.get(key) ?? 0;
    return total;
  }

  /** `prefix` ile başlayan sayaçların son `days` gündeki toplamları (ör. "download.") */
  sumsByPrefix(prefix: string, days: number, now = Date.now()): Record<string, number> {
    const out: Record<string, number> = {};
    for (const day of this.dayKeys(days, now)) {
      for (const [k, v] of this.days.get(day) ?? []) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = (out[k.slice(prefix.length)] ?? 0) + v;
      }
    }
    return out;
  }

  /** Gün gün değerler, eskiden yeniye */
  series(key: string, days: number, now = Date.now()): { day: string; count: number }[] {
    return this.dayKeys(days, now).map((day) => ({ day, count: this.days.get(day)?.get(key) ?? 0 }));
  }

  private dayKeys(days: number, now: number): string[] {
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY_MS, this.offsetMin));
    return keys;
  }

  /** Saklama süresinden eski günleri atar (anahtarlar YYYY-AA-GG: metin karşılaştırması tarih sırasıdır) */
  private prune(now: number): void {
    const oldest = dayKey(now - (COUNTER_DAYS - 1) * DAY_MS, this.offsetMin);
    for (const day of this.days.keys()) if (day < oldest) this.days.delete(day);
  }

  async persist(now = Date.now(), force = false): Promise<void> {
    if (!this.file || !this.dirty || (!force && now - this.lastPersist < PERSIST_INTERVAL_MS)) return;
    this.lastPersist = now;
    this.dirty = false;
    const days: CountersFile['days'] = {};
    for (const [day, map] of this.days) days[day] = Object.fromEntries(map);
    try {
      await writeJsonAtomic(this.file, { v: 1, since: this.since, days } satisfies CountersFile);
    } catch (err) {
      if (!this.warned) this.log?.warn({ err: String(err) }, 'sayaçlar kaydedilemedi');
      this.warned = true;
    }
  }
}
