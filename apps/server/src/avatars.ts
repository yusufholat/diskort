import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { AVATAR_MAX_BYTES, type User } from '@diskort/shared';
import { UploadError } from './attachments.js';
import type { Store } from './db.js';
import { inspectImage } from './fileInfo.js';

/** Diskteki ve adresteki ad: kullanıcıya ve içeriğe göre özet (128 bit, küçük harf onaltılık) */
export const AVATAR_HASH = /^[0-9a-f]{32}$/;
/** Kaydedilen fotoğrafın kenarı (piksel); istemciler en büyük 80 px gösterir, yüksek DPI için pay var */
export const AVATAR_SIZE = 256;
/** Çözülecek resmin en fazla piksel sayısı (~8192×8192): sıkıştırma bombalarına karşı */
const MAX_INPUT_PIXELS = 8192 * 8192;
/** Veritabanında karşılığı olmayan dosyalar için bekleme süresi (yarım kalan işlem, eski yedek) */
const ORPHAN_GRACE_MS = 60 * 60_000;

// Önbellek kapalı: aynı resim bir daha işlenmez, bellek boşuna tutulmasın (sunucuda LiveKit de çalışıyor)
sharp.cache(false);

/**
 * Profil fotoğrafları: yüklenen resim (PNG, JPEG, WebP, GIF; içeriğinden anlaşılır) EXIF yönüne göre
 * döndürülür, ortasından kare kırpılır ve 256×256 WebP olarak <dir>/<özet>.webp'ye yazılır. Yeniden
 * kodlandığı için konum (EXIF/GPS) dahil hiçbir üst veri kalmaz; hareketli resimlerin ilk karesi alınır.
 * Eski dosya fotoğraf değişince, kaldırılınca ve hesap silinince silinir.
 */
export class AvatarService {
  /** İşlemler sırayla: aynı anda tek resim çözülür (bellek) ve dosya/veritabanı güncellemeleri çakışmaz */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: Store,
    readonly dir: string,
    private readonly log?: { info(obj: unknown, msg?: string): void },
  ) {}

  pathOf(hash: string): string {
    return path.join(this.dir, `${hash}.webp`);
  }

  /** Gövdeyi okur, doğrular, küçültür ve kullanıcının fotoğrafı yapar; eskisini siler. */
  async upload(userId: string, body: Readable, declaredSize: number | null): Promise<User> {
    const input = await readLimited(body, declaredSize, AVATAR_MAX_BYTES);
    const image = inspectImage(input);
    if (!image) {
      throw new UploadError(415, 'unsupported_type', 'Yalnızca PNG, JPEG, WebP ya da GIF resim yüklenebilir.');
    }
    if (image.width !== null && image.height !== null && image.width * image.height > MAX_INPUT_PIXELS) {
      throw new UploadError(400, 'invalid_image', 'Resmin çözünürlüğü çok yüksek.');
    }
    return this.serial(async () => {
      const output = await normalize(input);
      const hash = createHash('sha256').update(userId).update('\0').update(output).digest('hex').slice(0, 32);
      await fs.promises.mkdir(this.dir, { recursive: true });
      const temp = path.join(this.dir, `${randomBytes(8).toString('hex')}.tmp`);
      try {
        await fs.promises.writeFile(temp, output, { flag: 'wx' });
        await fs.promises.rename(temp, this.pathOf(hash));
      } catch (err) {
        await fs.promises.rm(temp, { force: true });
        throw err;
      }
      const result = this.store.setAvatar(userId, hash);
      if (!result) {
        // Hesap bu arada silindi
        await this.removeFile(hash);
        throw new UploadError(404, 'not_found', 'Kullanıcı bulunamadı.');
      }
      if (result.previous && result.previous !== hash) await this.removeFile(result.previous);
      return result.user;
    });
  }

  /** Fotoğrafı kaldırır (baş harflere dönülür); kullanıcı yoksa null. */
  remove(userId: string): Promise<User | null> {
    return this.serial(async () => {
      const result = this.store.setAvatar(userId, null);
      if (!result) return null;
      if (result.previous) await this.removeFile(result.previous);
      return result.user;
    });
  }

  /** Silinen hesabın dosyası (özet hesap silinmeden önce alınır). */
  removeDeleted(hash: string | null): Promise<void> {
    if (!hash) return Promise.resolve();
    // Aynı resmi kullanan başka hesap olamaz: özet kullanıcı kimliğini de içerir
    return this.serial(() => this.removeFile(hash));
  }

  /** Temizlik: hiçbir kullanıcının kullanmadığı (yarım kalmış, eski yedekten kalan) dosyaları siler. */
  sweep(now = Date.now()): Promise<number> {
    return this.serial(async () => {
      const files = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
      const used = this.store.avatarHashes();
      let removed = 0;
      for (const file of files) {
        const match = /^([0-9a-f]{32})\.webp$/.exec(file);
        if (match ? used.has(match[1]!) : !/^[0-9a-f]{16}\.tmp$/.test(file)) continue; // bize ait olmayanlara dokunulmaz
        const full = path.join(this.dir, file);
        const stat = await fs.promises.stat(full).catch(() => null);
        if (!stat || now - stat.mtimeMs < ORPHAN_GRACE_MS) continue;
        await fs.promises.rm(full, { force: true });
        removed++;
      }
      if (removed > 0) this.log?.info({ removed }, 'kullanılmayan profil fotoğrafları silindi');
      return removed;
    });
  }

  private async removeFile(hash: string): Promise<void> {
    if (AVATAR_HASH.test(hash)) await fs.promises.rm(this.pathOf(hash), { force: true });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** Resmi çözer ve 256×256 WebP'ye çevirir; çözülemezse 400. */
async function normalize(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, {
      autoOrient: true,
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      // Hareketli GIF/WebP: yalnızca ilk kare
      pages: 1,
    });
    const { format } = await image.metadata();
    // İçerik denetimi zaten yapıldı; libvips'in başka bir çözücü seçmediğinden emin olunur
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp' && format !== 'gif') throw new Error(format);
    return await image
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    throw new UploadError(400, 'invalid_image', 'Resim okunamadı; dosya bozuk olabilir.');
  }
}

/** Gövdeyi en fazla `max` bayt olacak şekilde belleğe okur. */
export async function readLimited(body: Readable, declaredSize: number | null, max: number): Promise<Buffer> {
  const tooLarge = new UploadError(413, 'too_large', `Resim çok büyük (en fazla ${max / 1024 / 1024} MB).`);
  if (declaredSize !== null && declaredSize > max) throw tooLarge;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      // Döngüden çıkınca akış kapatılır; kalan gövde okunmaz
      if (size > max) throw tooLarge;
      chunks.push(buf);
    }
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(400, 'upload_failed', 'Resim yüklenemedi, bağlantı kesildi.');
  }
  if (size === 0) throw new UploadError(400, 'empty_file', 'Dosya boş.');
  return Buffer.concat(chunks, size);
}
