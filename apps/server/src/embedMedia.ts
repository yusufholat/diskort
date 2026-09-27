// Bağlantı önizlemelerinin resimleri istemcilere sunucumuz üzerinden gider: kullanıcıların IP'si ve
// tarayıcı bilgileri sitelere ulaşmaz. Adresler imzalıdır (HMAC; anahtar JWT_SECRET'tan türetilir):
// yalnızca önizleme hazırlanırken sunucunun ürettiği adresler çalışır, açık bir vekil (proxy) değildir.
// Resim güvenli istekle (safeFetch) indirilir (en fazla 8 MB, yalnızca image/*), içeriğinden PNG, JPEG,
// WebP ya da GIF olduğu doğrulanır ve yeniden kodlanır (küçültülür; üst veriler atılır): durağan resimler
// WebP, hareketli GIF'ler GIF (Android hareketli WebP gösteremez). Sonuç <dir>/<özet>.webp|.gif olarak
// diskte önbelleğe alınır; eski ve fazla dosyalar temizlikte silinir.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { inspectImage } from './fileInfo.js';
import { ConcurrencyLimiter } from './limiter.js';
import { readCapped, safeFetch, type SafeFetchOptions, type SafeResponse } from './safeFetch.js';

/** İndirilecek resmin en büyük boyutu */
export const EMBED_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
/** Durağan resmin en uzun kenarı (piksel) */
const STATIC_MAX_SIDE = 1600;
/** Hareketli GIF'in en uzun kenarı */
const ANIMATED_MAX_SIDE = 640;
/** Çözülecek resmin en fazla piksel sayısı (sıkıştırma bombalarına karşı) */
const MAX_INPUT_PIXELS = 40_000_000;
/** Hareketli resimde tüm karelerin toplam piksel sayısı ve kare sayısı sınırı; aşılırsa ilk kare */
const MAX_ANIMATED_PIXELS = 60_000_000;
const MAX_FRAMES = 300;
/** Yeniden kodlanmış hareketli GIF bundan büyükse ilk karesi kullanılır */
const MAX_ANIMATED_OUTPUT = 10 * 1024 * 1024;
/** Disk önbelleği: bu süredir kullanılmayan dosyalar ve toplam sınırı aşan en eskiler silinir */
const CACHE_TTL_MS = 14 * 24 * 60 * 60_000;
const CACHE_MAX_BYTES = 1024 * 1024 * 1024;
/** Başarısız indirme bu süre yeniden denenmez */
const FAILURE_TTL_MS = 10 * 60_000;
/** Önbellekteki dosyanın "son kullanım" zamanı en fazla bu sıklıkla güncellenir */
const TOUCH_INTERVAL_MS = 60 * 60_000;

const FILE_NAME = /^([0-9a-f]{40})\.(webp|gif)$/;
const SIGNATURE = /^[A-Za-z0-9_-]{32}$/;
const ENCODED_URL = /^[A-Za-z0-9_-]{1,4096}$/;

export type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeResponse>;

export interface MediaFile {
  path: string;
  contentType: 'image/webp' | 'image/gif';
  width: number;
  height: number;
  /** Önbellek anahtarı (ETag) */
  key: string;
}

interface Logger {
  warn(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
}

/** Resmi doğrular ve yeniden kodlar; resim değilse ya da çözülemezse null */
export async function processImage(data: Buffer): Promise<{ buffer: Buffer; format: 'webp' | 'gif'; width: number; height: number } | null> {
  const info = inspectImage(data);
  if (!info) return null;
  if (info.width && info.height && info.width * info.height > MAX_INPUT_PIXELS) return null;
  try {
    const probe = await sharp(data, { animated: true, limitInputPixels: false, failOn: 'error' }).metadata();
    if (!['png', 'jpeg', 'webp', 'gif'].includes(probe.format ?? '')) return null;
    const width = probe.width ?? 0;
    const pages = probe.pages ?? 1;
    const frameHeight = probe.pageHeight ?? probe.height ?? 0;
    if (!width || !frameHeight || width * frameHeight > MAX_INPUT_PIXELS) return null;
    const animated =
      probe.format === 'gif' && pages > 1 && pages <= MAX_FRAMES && width * frameHeight * pages <= MAX_ANIMATED_PIXELS;
    if (animated) {
      const scale = Math.min(1, ANIMATED_MAX_SIDE / width, ANIMATED_MAX_SIDE / frameHeight);
      const out = await sharp(data, { animated: true, limitInputPixels: false, failOn: 'error' })
        .resize({ width: Math.max(1, Math.round(width * scale)), withoutEnlargement: true })
        .gif({ effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (out.data.length <= MAX_ANIMATED_OUTPUT) {
        return {
          buffer: out.data,
          format: 'gif',
          width: out.info.width,
          height: Math.max(1, Math.round((frameHeight * out.info.width) / width)),
        };
      }
    }
    const out = await sharp(data, { pages: 1, autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .resize({ width: STATIC_MAX_SIDE, height: STATIC_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, format: 'webp', width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

export class EmbedMediaService {
  private readonly key: Buffer;
  private readonly inflight = new Map<string, Promise<MediaFile | null>>();
  private readonly failures = new Map<string, number>();
  /** Aynı anda en fazla iki resim indirilir/işlenir (bellek); sıra uzarsa yeni istekler reddedilir */
  private readonly work = new ConcurrencyLimiter(2, 100);

  constructor(
    readonly dir: string,
    secret: string,
    private readonly fetcher: Fetcher = safeFetch,
    private readonly log?: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createHmac('sha256', secret).update('diskort:embed-media:v1').digest();
  }

  private signature(encoded: string): string {
    return createHmac('sha256', this.key).update(encoded).digest('base64url').slice(0, 32);
  }

  /** İstemcilere verilen, sunucu köküne göre imzalı adres */
  sign(url: string): string {
    const encoded = Buffer.from(url, 'utf8').toString('base64url');
    return `/api/embed-media/${this.signature(encoded)}/${encoded}`;
  }

  /** İmza doğruysa asıl adres, değilse null */
  verify(signature: string, encoded: string): string | null {
    if (!SIGNATURE.test(signature) || !ENCODED_URL.test(encoded)) return null;
    const expected = Buffer.from(this.signature(encoded));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const url = Buffer.from(encoded, 'base64url').toString('utf8');
    return /^https?:\/\//i.test(url) ? url : null;
  }

  private hash(url: string): string {
    return createHash('sha256').update(url).digest('hex').slice(0, 40);
  }

  /** Önbellekteki dosya (varsa) */
  private async cachedFile(hash: string): Promise<MediaFile | null> {
    for (const [ext, contentType] of [
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
    ] as const) {
      const file = path.join(this.dir, `${hash}.${ext}`);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) continue;
      if (this.now() - stat.mtimeMs > TOUCH_INTERVAL_MS) {
        const at = new Date(this.now());
        await fs.promises.utimes(file, at, at).catch(() => undefined);
      }
      return { path: file, contentType, width: 0, height: 0, key: `${hash}.${ext}` };
    }
    return null;
  }

  /**
   * Resmin önbellekteki (yoksa indirilip işlenmiş) dosyası; alınamazsa null. `withSize` ise boyutları
   * da okunur (önizleme hazırlanırken).
   */
  async get(url: string, withSize = false): Promise<MediaFile | null> {
    const hash = this.hash(url);
    const cached = await this.cachedFile(hash);
    if (cached) return withSize ? this.withSize(cached) : cached;
    return this.once(hash, async () => {
      const failedAt = this.failures.get(hash);
      if (failedAt !== undefined && this.now() - failedAt < FAILURE_TTL_MS) return null;
      try {
        const res = await this.fetcher(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1', timeoutMs: 8000 });
        if (!res.contentType.startsWith('image/') || res.contentType.includes('svg')) {
          res.close();
          throw new Error(`resim değil: ${res.contentType}`);
        }
        const { data } = await readCapped(res, EMBED_MEDIA_MAX_BYTES);
        const file = await this.store(hash, data);
        if (!file) throw new Error('resim çözülemedi');
        return file;
      } catch (err) {
        this.fail(hash);
        this.log?.warn({ err: String(err) }, 'önizleme resmi alınamadı');
        return null;
      }
    });
  }

  /** Zaten indirilmiş resmi (doğrudan resim bağlantısı) işler ve önbelleğe yazar */
  async ingest(url: string, data: Buffer): Promise<MediaFile | null> {
    const hash = this.hash(url);
    const cached = await this.cachedFile(hash);
    if (cached) return this.withSize(cached);
    return this.once(hash, async () => {
      const file = await this.store(hash, data);
      if (!file) this.fail(hash);
      return file;
    });
  }

  private once(hash: string, fn: () => Promise<MediaFile | null>): Promise<MediaFile | null> {
    const running = this.inflight.get(hash);
    if (running) return running;
    const promise = this.work.run(fn).catch(() => null).finally(() => this.inflight.delete(hash));
    this.inflight.set(hash, promise);
    return promise;
  }

  private fail(hash: string): void {
    this.failures.set(hash, this.now());
    if (this.failures.size > 5000) {
      for (const [key, at] of this.failures) if (this.now() - at >= FAILURE_TTL_MS) this.failures.delete(key);
      while (this.failures.size > 5000) this.failures.delete(this.failures.keys().next().value!);
    }
  }

  private async withSize(file: MediaFile): Promise<MediaFile | null> {
    try {
      const meta = await sharp(file.path, { animated: true, limitInputPixels: false }).metadata();
      const height = meta.pageHeight ?? meta.height;
      if (!meta.width || !height) return null;
      return { ...file, width: meta.width, height };
    } catch {
      return null;
    }
  }

  private async store(hash: string, data: Buffer): Promise<MediaFile | null> {
    const processed = await processImage(data);
    if (!processed) return null;
    await fs.promises.mkdir(this.dir, { recursive: true });
    const name = `${hash}.${processed.format}`;
    const target = path.join(this.dir, name);
    const temp = path.join(this.dir, `${randomBytes(8).toString('hex')}.tmp`);
    try {
      await fs.promises.writeFile(temp, processed.buffer, { flag: 'wx' });
      await fs.promises.rename(temp, target);
    } catch (err) {
      await fs.promises.rm(temp, { force: true });
      throw err;
    }
    return {
      path: target,
      contentType: processed.format === 'gif' ? 'image/gif' : 'image/webp',
      width: processed.width,
      height: processed.height,
      key: name,
    };
  }

  /** Temizlik: uzun süredir kullanılmayanlar ve toplam sınırı aşan en eski dosyalar silinir */
  async sweep(): Promise<number> {
    const names = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    const files: { full: string; size: number; at: number }[] = [];
    let removed = 0;
    for (const name of names) {
      const ours = FILE_NAME.test(name) || /^[0-9a-f]{16}\.tmp$/.test(name);
      if (!ours) continue; // bize ait olmayanlara dokunulmaz
      const full = path.join(this.dir, name);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      const stale = name.endsWith('.tmp') ? this.now() - stat.mtimeMs > 60 * 60_000 : this.now() - stat.mtimeMs > CACHE_TTL_MS;
      if (stale) {
        await fs.promises.rm(full, { force: true });
        removed++;
      } else if (!name.endsWith('.tmp')) files.push({ full, size: stat.size, at: stat.mtimeMs });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= CACHE_MAX_BYTES) break;
      await fs.promises.rm(f.full, { force: true });
      total -= f.size;
      removed++;
    }
    if (removed > 0) this.log?.info?.({ removed }, 'önizleme resmi önbelleği temizlendi');
    return removed;
  }
}
