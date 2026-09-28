import fs from 'node:fs';
import path from 'node:path';

// Yönetim paneli: giriş kayıtları (başarılı / başarısız girişler, kayıtlar, şifre sıfırlama ve değiştirme,
// sınır aşımları). Son kayıtlar bellekte; hepsi <dataDir>/auth-log.jsonl dosyasına eklenir, 30 günden eskiler
// açılışta ve günde bir atılır. Şifre asla yazılmaz; hesabı olmayan bir kullanıcı adıyla deneme yapılırsa
// yazılan ad saklanmaz (yanlışlıkla ad alanına yazılmış bir şifre kayda geçmesin).

export type AuthEventKind = 'login' | 'login_failed' | 'register' | 'join' | 'reset' | 'password' | 'rate_limited';

export interface AuthEvent {
  at: number;
  kind: AuthEventKind;
  userId: string | null;
  username: string | null;
  ip: string;
  /** Tarayıcı/uygulama kimliği (kısaltılmış) ve ondan çıkarılan istemci türü */
  ua: string | null;
  client: string;
  /** Başarısızlık nedeni (ör. "şifre hatalı", "hesap yok") */
  detail?: string;
}

const RETENTION_MS = 30 * 86_400_000;
const MEMORY_MAX = 3_000;
const COMPACT_INTERVAL_MS = 86_400_000;

/** User-Agent'tan kısa istemci adı */
export function clientOf(ua: string | null | undefined): string {
  if (!ua) return 'bilinmiyor';
  if (/Electron\//.test(ua) || /\bdiskort\//i.test(ua)) return 'Masaüstü uygulaması';
  if (/okhttp/i.test(ua)) return 'Android uygulaması';
  if (/CFNetwork|Darwin/.test(ua) && !/Mozilla/.test(ua)) return 'iOS uygulaması';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  if (browser || os) return `Tarayıcı${browser ? ` · ${browser}` : ''}${os ? ` · ${os}` : ''}`;
  return ua.slice(0, 40);
}

function isEvent(v: unknown): v is AuthEvent {
  const e = v as Partial<AuthEvent> | null;
  return !!e && typeof e.at === 'number' && typeof e.kind === 'string' && typeof e.ip === 'string';
}

export class AuthLog {
  private events: AuthEvent[] = [];
  private buffer: string[] = [];
  private lastCompact = 0;
  private timer: NodeJS.Timeout | null = null;
  private warned = false;

  constructor(
    private readonly file: string | null,
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
    const since = now - RETENTION_MS;
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as unknown;
        if (isEvent(e) && e.at >= since) this.events.push(e);
      } catch {
        // bozuk satır atlanır
      }
    }
    if (this.events.length < lines.length) this.compact(now);
    if (this.events.length > MEMORY_MAX) this.events.splice(0, this.events.length - MEMORY_MAX);
    this.lastCompact = now;
  }

  start(): void {
    if (this.timer || !this.file) return;
    this.timer = setInterval(() => void this.flush(), 10_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  record(e: Omit<AuthEvent, 'at' | 'client'> & { at?: number }): void {
    const event: AuthEvent = {
      ...e,
      at: e.at ?? Date.now(),
      ua: e.ua ? e.ua.slice(0, 200) : null,
      client: clientOf(e.ua),
      username: e.username ? e.username.slice(0, 32) : null,
    };
    this.events.push(event);
    if (this.events.length > MEMORY_MAX) this.events.shift();
    if (this.file) this.buffer.push(JSON.stringify(event));
  }

  /** En yeniler önce */
  recent(limit: number, filter?: (e: AuthEvent) => boolean): AuthEvent[] {
    const out: AuthEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events[i]!;
      if (!filter || filter(e)) out.push(e);
    }
    return out;
  }

  countSince(since: number, kind: AuthEventKind): number {
    let n = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!;
      if (e.at < since) break;
      if (e.kind === kind) n++;
    }
    return n;
  }

  /** `since`ten beri başarısız giriş yapan adresler (en çoktan aza) */
  failuresByIp(since: number, limit = 10): { ip: string; count: number; last: number; usernames: string[] }[] {
    const byIp = new Map<string, { ip: string; count: number; last: number; usernames: Set<string> }>();
    for (const e of this.events) {
      if (e.at < since || (e.kind !== 'login_failed' && e.kind !== 'rate_limited')) continue;
      const entry = byIp.get(e.ip) ?? { ip: e.ip, count: 0, last: 0, usernames: new Set<string>() };
      entry.count++;
      entry.last = Math.max(entry.last, e.at);
      if (e.username) entry.usernames.add(e.username);
      byIp.set(e.ip, entry);
    }
    return [...byIp.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((x) => ({ ...x, usernames: [...x.usernames].slice(0, 5) }));
  }

  async flush(now = Date.now()): Promise<void> {
    if (!this.file) return;
    const lines = this.buffer;
    this.buffer = [];
    try {
      if (lines.length > 0) {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        await fs.promises.appendFile(this.file, lines.join('\n') + '\n');
      }
      if (now - this.lastCompact >= COMPACT_INTERVAL_MS) {
        this.lastCompact = now;
        this.compact(now);
      }
    } catch (err) {
      if (!this.warned) this.log?.warn({ err: String(err) }, 'giriş kayıtları yazılamadı');
      this.warned = true;
    }
  }

  /** Dosyayı yalnızca saklama süresindeki kayıtlarla yeniden yazar */
  private compact(now: number): void {
    if (!this.file) return;
    const since = now - RETENTION_MS;
    try {
      const keep = fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter((line) => {
          const at = Number(/"at":(\d+)/.exec(line)?.[1] ?? NaN);
          return Number.isFinite(at) && at >= since;
        });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, keep.join('\n') + (keep.length ? '\n' : ''));
      fs.renameSync(tmp, this.file);
    } catch {
      // bir sonraki sefere
    }
  }
}
