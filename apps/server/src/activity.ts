import fs from 'node:fs';
import type { ClientPlatform } from '@diskort/shared';
import { readJsonSync, writeJsonAtomic } from './systemStats.js';

// Yönetim paneli için bellekte ve küçük dosyalarda tutulan kullanım bilgileri: hesapların en son ne zaman
// bağlı olduğu (veritabanında yok; göç gerektirmesin diye <dataDir>/activity.json) ve son hatalar.

export interface SeenEntry {
  /** En son bağlı görüldüğü an */
  at: number;
  platform: ClientPlatform;
  version: string | null;
}

interface ActivityFile {
  v: 1;
  since: number;
  users: Record<string, SeenEntry>;
}

function isActivityFile(value: unknown): value is ActivityFile {
  const f = value as Partial<ActivityFile> | null;
  return !!f && f.v === 1 && typeof f.since === 'number' && typeof f.users === 'object' && f.users !== null;
}

/** Dosya en fazla bu sıklıkla yazılır */
const PERSIST_INTERVAL_MS = 60_000;

/**
 * Hesapların en son bağlı görüldüğü an, platform ve sürüm. Bağlı oturumlar düzenli aralıkla (panel
 * ölçümüyle birlikte) işlenir; bu yüzden birkaç saniyelik bağlantılar kaçabilir. Takip bu sürümle başladığı
 * için `since` öncesi bilinmez.
 */
export class ActivityTracker {
  private readonly seen = new Map<string, SeenEntry>();
  /** Takibin başladığı an */
  readonly since: number;
  private dirty = false;
  private lastPersist = 0;
  private persistWarned = false;

  constructor(
    private readonly file: string | null,
    now = Date.now(),
    private readonly log?: { warn(obj: object, msg: string): void },
  ) {
    const saved = readJsonSync(file);
    if (isActivityFile(saved)) {
      this.since = saved.since;
      for (const [id, e] of Object.entries(saved.users)) {
        if (typeof e?.at === 'number') this.seen.set(id, { at: e.at, platform: e.platform, version: e.version ?? null });
      }
    } else {
      this.since = now;
    }
  }

  /** Şu an bağlı oturumları "görüldü" olarak işler (hesabın en son bağlanan oturumunun platformu yazılır). */
  touch(sessions: readonly { userId: string; platform: ClientPlatform; version: string | null; connectedAt: number }[], now = Date.now()): void {
    const latest = new Map<string, (typeof sessions)[number]>();
    for (const s of sessions) {
      const cur = latest.get(s.userId);
      if (!cur || s.connectedAt >= cur.connectedAt) latest.set(s.userId, s);
    }
    for (const [userId, s] of latest) {
      this.seen.set(userId, { at: now, platform: s.platform, version: s.version });
    }
    if (latest.size > 0) this.dirty = true;
  }

  get(userId: string): SeenEntry | undefined {
    return this.seen.get(userId);
  }

  /** `since`ten sonra bağlı görülen hesaplar */
  idsSince(since: number): string[] {
    const ids: string[] = [];
    for (const [id, e] of this.seen) if (e.at >= since) ids.push(id);
    return ids;
  }

  /** Değiştiyse dosyaya yazar; `force` değilse en fazla dakikada bir */
  async persist(now = Date.now(), force = false): Promise<void> {
    if (!this.file || !this.dirty || (!force && now - this.lastPersist < PERSIST_INTERVAL_MS)) return;
    this.lastPersist = now;
    this.dirty = false;
    const data: ActivityFile = { v: 1, since: this.since, users: Object.fromEntries(this.seen) };
    try {
      await writeJsonAtomic(this.file, data);
    } catch (err) {
      if (!this.persistWarned) this.log?.warn({ err: String(err) }, 'etkinlik kaydı yazılamadı');
      this.persistWarned = true;
    }
  }
}

/** Hata kayıtlarının diskte tutulduğu süre */
const ERROR_RETENTION_MS = 14 * 86_400_000;

/**
 * Son N kaydı tutan halka tampon. Dosya verilirse her kayıt ona da eklenir (JSON satırları) ve açılışta
 * son N kayıt geri yüklenir: sunucu yeniden başlayınca (her dağıtımda) liste boşalmaz. 14 günden eskiler
 * açılışta atılır.
 */
export class RingLog<T extends { at: number }> {
  private readonly items: T[] = [];
  /** Kayıtlı toplam (dosyadan yüklenenler dahil) */
  total = 0;
  private warned = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly max: number,
    private readonly file: string | null = null,
    private readonly log?: { warn(obj: object, msg: string): void },
    now = Date.now(),
  ) {
    if (!file) return;
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const kept: string[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const item = JSON.parse(line) as T;
        if (typeof item?.at !== 'number' || now - item.at > ERROR_RETENTION_MS) continue;
        kept.push(line);
        this.items.push(item);
      } catch {
        // bozuk satır atlanır
      }
    }
    this.total = this.items.length;
    this.items.splice(0, Math.max(0, this.items.length - max));
    try {
      fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
    } catch (err) {
      this.warn(err);
    }
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
    this.total++;
    if (!this.file) return;
    // Eklemeler sırayla (aynı anda gelen kayıtlar dosyada karışmasın)
    const line = JSON.stringify(item) + '\n';
    const file = this.file;
    this.writing = this.writing.then(() => fs.promises.appendFile(file, line)).catch((err: unknown) => this.warn(err));
  }

  private warn(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.log?.warn({ err: String(err) }, 'hata kaydı yazılamadı');
  }

  /** En yeniler önce */
  recent(limit: number): T[] {
    return this.items.slice(-limit).reverse();
  }

  /** `since`ten sonraki kayıt sayısı; tampon dolu ve en eskisi de o aralıktaysa gerçek sayı daha büyük olabilir */
  countSince(since: number): { count: number; capped: boolean } {
    let count = 0;
    for (const item of this.items) if (item.at >= since) count++;
    return { count, capped: this.items.length >= this.max && (this.items[0]?.at ?? 0) >= since };
  }
}

/** İstemcinin bildirdiği beklenmedik hata (POST /api/client-errors) */
export interface ClientErrorEntry {
  at: number;
  platform: ClientPlatform;
  version: string;
  where: string;
  message: string;
  stack?: string;
  /** Oturum açıksa kullanıcı adı */
  user: string | null;
}

/** Sunucuda 5xx ile biten istek */
export interface ServerErrorEntry {
  at: number;
  method: string;
  /** Yol kalıbı (ör. /api/channels/:id/messages); kimlikler ve sorgu yok */
  route: string;
  status: number;
  message: string;
}

export interface ErrorLog {
  client: RingLog<ClientErrorEntry>;
  server: RingLog<ServerErrorEntry>;
}

/** Her türden en fazla bu kadar hata tutulur */
export const ERROR_LOG_SIZE = 200;

/** Hata kayıtları; dosya yolları verilirse (DATA_DIR) kalıcıdır */
export const createErrorLog = (
  files: { client: string | null; server: string | null } = { client: null, server: null },
  log?: { warn(obj: object, msg: string): void },
): ErrorLog => ({
  client: new RingLog<ClientErrorEntry>(ERROR_LOG_SIZE, files.client, log),
  server: new RingLog<ServerErrorEntry>(ERROR_LOG_SIZE, files.server, log),
});
