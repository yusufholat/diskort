import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { ACTIVITY_ICON_KEY_PATTERN, ACTIVITY_ICON_MAX_BYTES, ACTIVITY_ICON_MAX_SIZE_PX } from '@diskort/shared';
import { UploadError } from './attachments.js';

/** İkonun en küçük kenarı (piksel) */
export const ACTIVITY_ICON_MIN_SIZE_PX = 16;
/** Saklanan ikon sayısının üst sınırı (disk dolmasın; ikon başına en fazla 64 KB → en çok ~320 MB) */
export const ACTIVITY_ICON_MAX_COUNT = 5000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * IHDR, IDAT ve IEND dışında kabul edilen parçalar ve geçerli uzunlukları: palet, saydamlık ve zararsız
 * renk/ölçü bilgisi. Her biri en fazla bir kez ve piksel verisinden (IDAT) önce gelebilir. Metin (tEXt…),
 * hareket (APNG: acTL, fcTL, fdAT), renk profili ve özel parçalar reddedilir: dosya olduğu gibi
 * sunulduğundan içinde başka veri taşınmasın.
 */
const PNG_EXTRA_CHUNKS = new Map<string, (length: number) => boolean>([
  ['PLTE', (length) => length > 0 && length <= 768 && length % 3 === 0],
  ['tRNS', (length) => length > 0 && length <= 256],
  ['gAMA', (length) => length === 4],
  ['sRGB', (length) => length === 1],
  ['pHYs', (length) => length === 9],
]);
/** Renk türü → kanal sayısı ve geçerli bit derinlikleri (PNG belirtimi) */
const PNG_COLOR_TYPES: Record<number, { channels: number; depths: readonly number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};

/**
 * Sıkıştırılmış piksel verisi (IDAT'ların birleşimi) tam beklenen kadar mı: açılınca satır başına süzgeç baytı
 * + pikseller, ne eksik ne fazla; zlib akışından sonra artık bayt yok. Böylece IDAT içinde de başka veri
 * taşınamaz ve açılan boyut baştan sınırlıdır.
 */
function pixelDataFits(data: Buffer, rawSize: number): boolean {
  try {
    const { buffer, engine } = inflateSync(data, { maxOutputLength: rawSize + 1, info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    return buffer.length === rawSize && engine.bytesWritten === data.length;
  } catch {
    return false;
  }
}

/**
 * PNG'nin yapısını denetler: imza, ilk parça IHDR, ardından izinli ek parçalar (bkz. PNG_EXTRA_CHUNKS), art
 * arda IDAT'lar ve IEND; her parçanın CRC'si tutar, IEND'den sonra artık bayt yok. Geçişli (interlaced) PNG
 * kabul edilmez. Boyutlar ikon sınırları içindeyse sıkıştırılmış verinin uzunluğu da denetlenir (dışındaysa
 * çağıran zaten boyuttan reddeder; veri hiç açılmaz). Geçerliyse boyutları döner. Piksellerin kendisi burada
 * çözülmez (bkz. decodes).
 */
export function inspectPng(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  let offset = PNG_SIGNATURE.length;
  let header: { width: number; height: number; rowBytes: number } | null = null;
  const seen = new Set<string>();
  const data: Buffer[] = [];
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buf.length) return null;
    if (crc32(buf.subarray(offset + 4, end - 4)) !== buf.readUInt32BE(end - 4)) return null;
    const body = buf.subarray(offset + 8, end - 4);
    if (!header) {
      if (type !== 'IHDR' || length !== 13) return null;
      const color = PNG_COLOR_TYPES[body[9]!];
      // Sıkıştırma ve süzgeç yöntemi 0; geçişli (interlace, 1) resim alınmaz
      if (!color?.depths.includes(body[8]!) || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return null;
      const width = body.readUInt32BE(0);
      header = { width, height: body.readUInt32BE(4), rowBytes: Math.ceil((width * color.channels * body[8]!) / 8) };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') {
      if (length !== 0 || data.length === 0 || end !== buf.length) return null;
      const { width, height, rowBytes } = header;
      const inRange = width > 0 && height > 0 && Math.max(width, height) <= ACTIVITY_ICON_MAX_SIZE_PX;
      if (inRange && !pixelDataFits(Buffer.concat(data), height * (1 + rowBytes))) return null;
      return { width, height };
    } else {
      // Ek parça: izinli, uzunluğu geçerli, ilk kez ve IDAT'tan önce (IDAT'lar arasına ya da sonrasına giremez)
      if (!PNG_EXTRA_CHUNKS.get(type)?.(length) || seen.has(type) || data.length > 0) return null;
      seen.add(type);
    }
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
  private readonly maxCount: number;
  private readonly log: { warn(obj: unknown, msg?: string): void } | undefined;
  /** Depo doldu uyarısı bir kez yazılır */
  private fullLogged = false;

  constructor(
    readonly dir: string,
    opts: { maxCount?: number; log?: { warn(obj: unknown, msg?: string): void } } = {},
  ) {
    this.maxCount = opts.maxCount ?? ACTIVITY_ICON_MAX_COUNT;
    this.log = opts.log;
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      // Klasör yok: henüz ikon yüklenmemiş
    }
    for (const file of files) {
      const full = path.join(dir, file);
      const key = file.endsWith('.png') ? file.slice(0, -4) : '';
      // Tek bir dosyadaki hata (ör. izin) sunucunun açılmasını engellemez: dosya atlanır
      try {
        if (ACTIVITY_ICON_KEY_PATTERN.test(key)) {
          // Boş dosya (yazılırken elektrik kesilmiş): silinir, istemci yeniden yükler
          if (fs.statSync(full, { throwIfNoEntry: false })?.size) this.keys.add(key);
          else fs.rmSync(full, { force: true });
        }
        // Yarım kalmış yükleme (sunucu yazarken kapanmış)
        else if (/^[0-9a-f]{16}\.tmp$/.test(file)) fs.rmSync(full, { force: true });
      } catch (err) {
        this.log?.warn({ file, err: String(err) }, 'etkinlik ikonu dosyası okunamadı, atlandı');
      }
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
    if (this.keys.size >= this.maxCount) {
      if (!this.fullLogged) this.log?.warn({ count: this.keys.size }, 'etkinlik ikonu deposu dolu: yeni ikon alınmıyor');
      this.fullLogged = true;
      throw new UploadError(507, 'storage_full', 'İkon deposu dolu.');
    }
    await fs.promises.mkdir(this.dir, { recursive: true });
    const temp = path.join(this.dir, `${randomBytes(8).toString('hex')}.tmp`);
    try {
      // Diske indiği kesinleşmeden adı verilmez: ani kapanmada boş ya da yarım ikon kalmasın
      const handle = await fs.promises.open(temp, 'wx');
      try {
        await handle.writeFile(png);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.promises.rename(temp, path.join(this.dir, `${key}.png`));
    } catch (err) {
      // Temizlik başarısız olsa da asıl hata bildirilir
      await fs.promises.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
    this.keys.add(key);
    return true;
  }
}

export const tooLarge = (): UploadError =>
  new UploadError(413, 'too_large', `İkon çok büyük (en fazla ${ACTIVITY_ICON_MAX_BYTES / 1024} KB).`);
