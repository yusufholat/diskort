import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { ACTIVITY_ICON_KEY_PATTERN, ACTIVITY_ICON_MAX_BYTES, ACTIVITY_ICON_MAX_SIZE_PX } from '@diskort/shared';
import { UploadError } from './attachments.js';

/** İkonun en küçük kenarı (piksel) */
export const ACTIVITY_ICON_MIN_SIZE_PX = 16;
/** Saklanan ikon sayısının üst sınırı (disk dolmasın; ikon başına en fazla 64 KB → en çok ~320 MB) */
export const ACTIVITY_ICON_MAX_COUNT = 5000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Renk türü → geçerli bit derinlikleri (PNG belirtimi) */
const PNG_BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/**
 * PNG'nin yapısını denetler: imza, ilk parça IHDR, parçalar (uzunluk, ad, CRC) IEND'e dek sırayla, IEND'den
 * sonra artık bayt yok. Geçerliyse boyutları döner. Piksel verisi burada çözülmez (bkz. decodes).
 */
export function inspectPng(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  let offset = PNG_SIGNATURE.length;
  let size: { width: number; height: number } | null = null;
  let hasData = false;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buf.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (crc32(buf.subarray(offset + 4, end - 4)) !== buf.readUInt32BE(end - 4)) return null;
    if (!size) {
      if (type !== 'IHDR' || length !== 13) return null;
      const data = buf.subarray(offset + 8, offset + 21);
      const depths = PNG_BIT_DEPTHS[data[9]!];
      // Sıkıştırma ve süzgeç yöntemi 0, geçişli (interlace) 0 ya da 1 olabilir
      if (!depths?.includes(data[8]!) || data[10] !== 0 || data[11] !== 0 || data[12]! > 1) return null;
      size = { width: data.readUInt32BE(0), height: data.readUInt32BE(4) };
    } else if (type === 'IHDR') return null;
    else if (type === 'IDAT') hasData = true;
    else if (type === 'IEND') return length === 0 && hasData && end === buf.length ? size : null;
    offset = end;
  }
  return null;
}

/** Piksel verisi gerçekten çözülüyor mu (bozuk ya da sıkıştırma bombası olan dosya saklanmasın) */
async function decodes(png: Buffer, size: number): Promise<boolean> {
  try {
    const { info } = await sharp(png, { failOn: 'error', limitInputPixels: size * size, pages: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return info.width === size && info.height === size;
  } catch {
    return false;
  }
}

/**
 * Etkinlik (oyun) ikonları: istemcinin oyunun çalıştırılabilir dosyasından çıkardığı küçük kare PNG'ler.
 * <dir>/<anahtar>.png olarak durur; anahtar dosyanın SHA-256'sı olduğundan aynı oyunun ikonu bir kez
 * saklanır, içerik hiç değişmez (süresiz önbelleklenir) ve dosya olduğu gibi (yeniden kodlanmadan) sunulur.
 * Var olan anahtarlar bellekte tutulur: gateway her ACTIVITY_SET'te diske bakmaz.
 */
export class ActivityIconStore {
  private readonly keys = new Set<string>();

  constructor(
    readonly dir: string,
    private readonly maxCount = ACTIVITY_ICON_MAX_COUNT,
  ) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      // Klasör yok: henüz ikon yüklenmemiş
    }
    for (const file of files) {
      const key = file.endsWith('.png') ? file.slice(0, -4) : '';
      if (ACTIVITY_ICON_KEY_PATTERN.test(key)) this.keys.add(key);
      // Yarım kalmış yükleme (sunucu yazarken kapanmış)
      else if (/^[0-9a-f]{16}\.tmp$/.test(file)) fs.rmSync(path.join(dir, file), { force: true });
    }
  }

  get count(): number {
    return this.keys.size;
  }

  /** İkon sunucuda var mı */
  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** Dosyanın yolu; yalnızca var olan (dolayısıyla biçimi doğrulanmış) anahtar için, yoksa null */
  pathOf(key: string): string | null {
    return this.keys.has(key) ? path.join(this.dir, `${key}.png`) : null;
  }

  /**
   * İkonu doğrular ve saklar. Zaten varsa dokunmaz (false döner), yeni yazıldıysa true. `allow`, yalnızca
   * yeni bir ikon için (doğrulamadan önce) sorulur: aynı ikonu yeniden gönderen istemci sınıra takılmaz.
   */
  async save(key: string, png: Buffer, allow: () => boolean = () => true): Promise<boolean> {
    if (!ACTIVITY_ICON_KEY_PATTERN.test(key)) throw new UploadError(400, 'invalid_key', 'Geçersiz ikon anahtarı.');
    if (png.length === 0) throw new UploadError(400, 'empty_file', 'Dosya boş.');
    if (png.length > ACTIVITY_ICON_MAX_BYTES) throw tooLarge();
    if (createHash('sha256').update(png).digest('hex') !== key) {
      throw new UploadError(400, 'hash_mismatch', 'İkon anahtarı dosyanın özetiyle uyuşmuyor.');
    }
    if (this.keys.has(key)) return false;
    if (!allow()) throw new UploadError(429, 'rate_limited', 'Çok fazla ikon yükledin, biraz bekle.');
    const size = inspectPng(png);
    if (!size) throw new UploadError(415, 'unsupported_type', 'Yalnızca PNG ikon yüklenebilir.');
    if (
      size.width !== size.height ||
      size.width < ACTIVITY_ICON_MIN_SIZE_PX ||
      size.width > ACTIVITY_ICON_MAX_SIZE_PX
    ) {
      throw new UploadError(
        400,
        'invalid_image',
        `İkon kare olmalı ve kenarı ${ACTIVITY_ICON_MIN_SIZE_PX}–${ACTIVITY_ICON_MAX_SIZE_PX} piksel arasında olmalı.`,
      );
    }
    if (!(await decodes(png, size.width))) {
      throw new UploadError(400, 'invalid_image', 'İkon okunamadı; dosya bozuk olabilir.');
    }
    // Beklerken başka bir istek aynı ikonu yazmış olabilir
    if (this.keys.has(key)) return false;
    if (this.keys.size >= this.maxCount) throw new UploadError(507, 'storage_full', 'İkon deposu dolu.');
    await fs.promises.mkdir(this.dir, { recursive: true });
    const temp = path.join(this.dir, `${randomBytes(8).toString('hex')}.tmp`);
    try {
      await fs.promises.writeFile(temp, png, { flag: 'wx' });
      await fs.promises.rename(temp, path.join(this.dir, `${key}.png`));
    } catch (err) {
      await fs.promises.rm(temp, { force: true });
      throw err;
    }
    this.keys.add(key);
    return true;
  }
}

export const tooLarge = (): UploadError =>
  new UploadError(413, 'too_large', `İkon çok büyük (en fazla ${ACTIVITY_ICON_MAX_BYTES / 1024} KB).`);
