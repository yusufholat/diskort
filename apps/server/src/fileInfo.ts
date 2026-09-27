// Yüklenen dosyaların incelenmesi: tür (içerikten), resim boyutu, JPEG konum bilgisinin silinmesi,
// dosya adının temizlenmesi ve sunulurken kullanılacak güvenli başlıklar. Yalnızca dosyanın başı
// (ilk birkaç yüz KB) okunur; resim çözülmez, dış kütüphane gerekmez.

export interface ImageInfo {
  type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number | null;
  height: number | null;
  /** JPEG'de EXIF konum (GPS) bilgisinin sıfırlanacağı bölgeler: [dosyadaki konum, uzunluk] */
  scrub: [number, number][];
}

/** Dosyanın başından resim türünü ve boyutunu çıkarır; desteklenen bir resim değilse null. */
export function inspectImage(head: Buffer): ImageInfo | null {
  try {
    if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47 && head.toString('latin1', 12, 16) === 'IHDR') {
      return { type: 'image/png', width: head.readUInt32BE(16), height: head.readUInt32BE(20), scrub: [] };
    }
    if (head.length >= 10 && /^GIF8[79]a$/.test(head.toString('latin1', 0, 6))) {
      return { type: 'image/gif', width: head.readUInt16LE(6), height: head.readUInt16LE(8), scrub: [] };
    }
    if (head.length >= 16 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
      return { type: 'image/webp', ...webpSize(head), scrub: [] };
    }
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return inspectJpeg(head);
  } catch {
    // bozuk başlık: resim sayılmaz
  }
  return null;
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return { width: null, height: null };
}

/** JPEG bölümlerini SOF'a kadar gezer: boyut, EXIF yönü ve GPS bölgeleri. */
function inspectJpeg(b: Buffer): ImageInfo {
  const info: ImageInfo = { type: 'image/jpeg', width: null, height: null, scrub: [] };
  let orientation = 1;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) break;
    const marker = b[pos + 1]!;
    if (marker === 0xff) {
      pos++; // dolgu baytı
      continue;
    }
    // Uzunluğu olmayan bölümler
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // görüntü verisi başladı
    const length = b.readUInt16BE(pos + 2);
    const start = pos + 4;
    const end = pos + 2 + length;
    if (length < 2 || end > b.length) break;
    // SOF0–SOF15 (DHT, JPG ve DAC hariç): yükseklik, genişlik
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      info.height = b.readUInt16BE(start + 1);
      info.width = b.readUInt16BE(start + 3);
      break;
    }
    if (marker === 0xe1 && b.toString('latin1', start, start + 6) === 'Exif\0\0') {
      const exif = readExif(b, start + 6, end);
      orientation = exif.orientation;
      info.scrub.push(...exif.scrub);
    }
    pos = end;
  }
  // 5–8: resim 90° döndürülerek gösterilir
  if (orientation >= 5 && orientation <= 8 && info.width !== null && info.height !== null) {
    [info.width, info.height] = [info.height, info.width];
  }
  return info;
}

const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/**
 * EXIF (TIFF) bloğundan yönü okur ve GPS alt dizinindeki her şeyin (kayıtlar ve işaret ettikleri
 * değerler) sıfırlanacağı bölgeleri döner. Dizin boş kalır; dosyanın geri kalanı değişmez.
 */
function readExif(b: Buffer, tiff: number, end: number): { orientation: number; scrub: [number, number][] } {
  const result = { orientation: 1, scrub: [] as [number, number][] };
  const order = b.toString('latin1', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return result;
  const le = order === 'II';
  const u16 = (at: number): number => (le ? b.readUInt16LE(at) : b.readUInt16BE(at));
  const u32 = (at: number): number => (le ? b.readUInt32LE(at) : b.readUInt32BE(at));
  const inside = (at: number, size: number): boolean => at >= tiff && at + size <= end;

  const ifd0 = tiff + u32(tiff + 4);
  if (!inside(ifd0, 2)) return result;
  const count = u16(ifd0);
  let gps: number | null = null;
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (!inside(entry, 12)) break;
    const tag = u16(entry);
    if (tag === 0x0112) result.orientation = u16(entry + 8);
    if (tag === 0x8825) gps = tiff + u32(entry + 8);
  }
  if (gps === null || !inside(gps, 2)) return result;

  const gpsCount = u16(gps);
  for (let i = 0; i < gpsCount; i++) {
    const entry = gps + 2 + i * 12;
    if (!inside(entry, 12)) break;
    const size = (TIFF_TYPE_SIZES[u16(entry + 2)] ?? 1) * u32(entry + 4);
    // 4 bayttan büyük değerler kaydın işaret ettiği yerde durur
    if (size > 4) {
      const at = tiff + u32(entry + 8);
      if (inside(at, size)) result.scrub.push([at, size]);
    }
  }
  // Kayıt sayısı ve kayıtlar (ve sonraki dizin göstergesi) sıfırlanır: dizin boş görünür
  const table = 2 + gpsCount * 12 + 4;
  result.scrub.push([gps, Math.min(table, end - gps)]);
  return result;
}

// ---------- Dosya adı ----------

const MAX_NAME_LENGTH = 100;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Yazı yönünü değiştiren karakterler: "resim\u202Egpj.exe" gibi uzantı gizlemeye karşı */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** Yükleyenin verdiği adı güvenli, gösterilebilir bir dosya adına çevirir. */
export function sanitizeFileName(raw: string): string {
  let name = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  name = name
    .replace(/\s+/g, ' ')
    .replace(CONTROL, '')
    .replace(BIDI, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
    const keep = ext.length > 0 && ext.length <= 16 ? ext : [];
    name = chars.slice(0, MAX_NAME_LENGTH - keep.length).join('').trimEnd() + keep.join('');
  }
  return name || 'dosya';
}

// ---------- Tür ve sunum başlıkları ----------

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;

/** Yükleyenin bildirdiği türü sadeleştirir (parametreler atılır); anlamsızsa octet-stream. */
export function declaredType(raw: string | undefined): string {
  const type = (raw ?? '').split(';')[0]!.trim().toLowerCase();
  return MIME.test(type) ? type : 'application/octet-stream';
}

/**
 * Tarayıcıda açılsa bile etkin içerik çalıştıramayan türler; indirilen dosya doğru uygulamayla açılsın
 * diye olduğu gibi etiketlenir. HTML, SVG, XML, JavaScript vb. hiçbir zaman: bunlar octet-stream olur.
 */
const PASSIVE_TYPES = new Set([
  'text/plain',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/gzip',
  'application/x-tar',
  'application/vnd.android.package-archive',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'audio/flac',
]);

/** Dosya sunulurken gönderilecek Content-Type */
export function servedType(contentType: string, inlineImage: boolean): string {
  if (inlineImage) return contentType;
  if (contentType === 'text/plain') return 'text/plain; charset=utf-8';
  return PASSIVE_TYPES.has(contentType) ? contentType : 'application/octet-stream';
}

/** RFC 6266: ASCII yedek ad ve UTF-8 asıl ad */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
