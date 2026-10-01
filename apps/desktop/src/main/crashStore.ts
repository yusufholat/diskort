import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CrashContext, CrashReport } from '../shared/bridge';

/**
 * Süreç çökmesi bildirimlerinin diskteki kuyruğu ve metinleri (Electron'a bağlı değildir; bkz. crashReport.ts).
 * Bildirim önce dosyaya yazılır (<userData>/crash-reports.json), arayüz sunucuya gönderince silinir: çökme
 * gönderime engel olursa (arayüz süreci gitti, ağ yok, ana süreç hatası) bildirim sonraki açılışta gider.
 */

/** Bekleyen en fazla bildirim (fazlasında en eskisi atılır) */
export const MAX_PENDING = 20;
/** Sunucunun sınırları (bkz. routes/clientErrors.ts): message ≤ 500, stack ≤ 4000 */
export const MESSAGE_MAX = 500;
export const DETAIL_MAX = 4000;
/** Daha önce bildirilen döküm dosyalarının hatırlanan adları */
const MAX_DUMP_NAMES = 40;

interface State {
  reports: CrashReport[];
  /** Bildirilmiş döküm dosyaları (sonraki açılışta yeniden bildirilmesin) */
  dumps: string[];
}

export const EMPTY_CONTEXT: CrashContext = { voice: false, streaming: false, watching: false };

/** Arayüzden gelen durum: yalnızca üç mantıksal alan kabul edilir */
export function parseCrashContext(value: unknown): CrashContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.voice !== 'boolean' || typeof v.streaming !== 'boolean' || typeof v.watching !== 'boolean') return null;
  return { voice: v.voice, streaming: v.streaming, watching: v.watching };
}

export interface DumpInfo {
  name: string;
  /** Bayt */
  size: number;
  mtimeMs: number;
  /** Tam yol (yalnızca yerelde kullanılır; bildirime girmez) */
  path: string;
}

/** Döküm klasöründeki .dmp dosyaları (Crashpad: reports/, completed/, pending/ alt klasörleri), yeniden eskiye */
export function listDumps(dir: string, depth = 2): DumpInfo[] {
  const out: DumpInfo[] = [];
  const walk = (d: string, left: number): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(d, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          if (left > 0) walk(full, left - 1);
        } else if (name.toLowerCase().endsWith('.dmp')) {
          out.push({ name, size: st.size, mtimeMs: st.mtimeMs, path: full });
        }
      } catch {
        // bu arada silinmiş olabilir
      }
    }
  };
  walk(dir, depth);
  return out.sort((x, y) => y.mtimeMs - x.mtimeMs);
}

/** En yeni `keep` döküm dışındakileri siler (yerel dökümler sunucuya gönderilmez; disk dolmasın) */
export function pruneDumps(dir: string, keep: number): void {
  for (const d of listDumps(dir).slice(keep)) rmSync(d.path, { force: true });
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Metindeki yerel yolları yer tutucularla değiştirir: hata mesajı ve yığınındaki mutlak yollar işletim
 * sistemi kullanıcı adını taşır (C:\Users\<ad>\…), bildirime girmemeli. Verilen yollar (ör. uygulama klasörü,
 * ev klasörü; uzun olan önce verilmeli) üç yazımıyla aranır: olduğu gibi, JSON'da kaçışlı (\\) ve düz
 * eğik çizgili (file:// adresleri). Ardından kalan her "Users/<ad>" ve "home/<ad>" öneki de `~` yapılır.
 */
export function scrubPaths(text: string, replacements: readonly (readonly [path: string, placeholder: string])[]): string {
  let out = text;
  for (const [path, placeholder] of replacements) {
    if (path.length < 3) continue;
    const variants = new Set([path, path.replace(/\\/g, '\\\\'), path.replace(/\\/g, '/')]);
    for (const v of variants) out = out.replace(new RegExp(escapeRegExp(v), 'gi'), placeholder);
  }
  // En iyi çaba: yalnızca kökten başlayan yollar (sürücü harfi, ya da sözcük başındaki / file:// sonrasındaki
  // '/'); adreslerdeki "/api/users/…" gibi parçalara dokunulmaz. Boşluklu adın yalnızca ilk sözcüğü gider
  // (asıl ev klasörü yukarıdaki listeyle tam temizlenir).
  return out.replace(/(?:(?<![A-Za-z])[A-Za-z]:[\\/]+|(?:(?<![\w.\/-])|(?<=file:\/\/))\/)(?:Users|home)[\\/]+[^\\/\s"'<>:|]+/gi, '~');
}

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/** Bildirimin ayrıntısı: ortam bilgisi (JSON) ve varsa hata yığını; sunucu sınırına kısaltılır */
export function buildDetail(info: Record<string, unknown>, stack?: string): string {
  let text = JSON.stringify(info);
  if (text.length > DETAIL_MAX) text = JSON.stringify({ ...info, gpu: undefined, processes: undefined });
  if (stack) text = `${text}\n${stack}`;
  return text.slice(0, DETAIL_MAX);
}

export class CrashStore {
  private state: State;
  private seq = 0;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    /** Saklanmadan önce mesaj ve ayrıntıya uygulanır (yerel yolların temizlenmesi) */
    private readonly scrub: (text: string) => string = (text) => text,
  ) {
    this.state = this.load();
  }

  private load(): State {
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<State>;
      const reports = Array.isArray(v.reports)
        ? v.reports.filter(
            (r): r is CrashReport =>
              !!r && typeof r.id === 'string' && typeof r.where === 'string' && typeof r.message === 'string' && typeof r.at === 'number',
          )
        : [];
      const dumps = Array.isArray(v.dumps) ? v.dumps.filter((d): d is string => typeof d === 'string') : [];
      return { reports: reports.slice(-MAX_PENDING), dumps: dumps.slice(-MAX_DUMP_NAMES) };
    } catch {
      return { reports: [], dumps: [] };
    }
  }

  /** Eşzamanlı yazar (çökme anında beklenemez); yazılamazsa bildirim yalnızca bellekte kalır */
  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.file);
    } catch {
      // disk dolu / izin yok: uygulama çalışmaya devam eder
    }
  }

  /** Yeni bildirim: dosyaya yazılır ve kimliği döner */
  add(where: string, message: string, detail: string): string {
    const at = this.now();
    const id = `${at.toString(36)}-${(this.seq++).toString(36)}`;
    this.state.reports.push({
      id,
      at,
      where: where.slice(0, 64),
      message: this.scrub(message).slice(0, MESSAGE_MAX),
      detail: this.scrub(detail).slice(0, DETAIL_MAX),
    });
    if (this.state.reports.length > MAX_PENDING) this.state.reports.splice(0, this.state.reports.length - MAX_PENDING);
    this.save();
    return id;
  }

  /** Bekleyen bildirime (hâlâ bekliyorsa) döküm dosyasının adını ve boyutunu ekler */
  attachDump(id: string, dump: DumpInfo): void {
    this.noteDump(dump.name);
    const report = this.state.reports.find((r) => r.id === id);
    if (report) report.message = `${report.message} · döküm: ${dump.name} (${kb(dump.size)})`.slice(0, MESSAGE_MAX);
    this.save();
  }

  private noteDump(name: string): void {
    if (this.state.dumps.includes(name)) return;
    this.state.dumps.push(name);
    if (this.state.dumps.length > MAX_DUMP_NAMES) this.state.dumps.splice(0, this.state.dumps.length - MAX_DUMP_NAMES);
  }

  /**
   * Açılışta: önceki oturumdan kalan, hiç bildirilmemiş dökümler (ör. ana süreç yerel olarak çöktü: JS'te
   * hiçbir olay çalışmaz, tek iz döküm dosyasıdır). Her biri bir kez bildirilir.
   */
  reportNewDumps(dumps: readonly DumpInfo[], detail: string): number {
    let added = 0;
    for (const d of dumps) {
      if (this.state.dumps.includes(d.name)) continue;
      this.noteDump(d.name);
      this.add('masaustu-surec', `Önceki oturumdan çökme dökümü: ${d.name} (${kb(d.size)}, ${new Date(d.mtimeMs).toISOString()})`, detail);
      added++;
    }
    if (added === 0) this.save();
    return added;
  }

  pending(): CrashReport[] {
    return this.state.reports.map((r) => ({ ...r }));
  }

  /** Sunucuya ulaşan bildirimler kuyruktan çıkar */
  ack(ids: readonly string[]): void {
    const before = this.state.reports.length;
    this.state.reports = this.state.reports.filter((r) => !ids.includes(r.id));
    if (this.state.reports.length !== before) this.save();
  }
}
