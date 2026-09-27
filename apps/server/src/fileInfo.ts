// Yüklenen dosyaların incelenmesi: tür (içerikten), resim ve video boyutu, JPEG konum bilgisinin
// silinmesi, dosya adının temizlenmesi, sunulurken kullanılacak güvenli başlıklar ve HTTP Range.
// Yalnızca dosyanın başı (ilk birkaç yüz KB; MP4'te ayrıca "moov" kutusu) okunur; resim/video
// çözülmez, dış kütüphane gerekmez.

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

// ---------- Video ----------

export interface VideoInfo {
  type: 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/x-matroska';
  width: number | null;
  height: number | null;
  /** Saniye */
  duration: number | null;
}

/**
 * ISO-BMFF "ftyp" ana markaları: yalnızca video kapları. HEIC/AVIF resimleri (heic, mif1, avif…) ve
 * yalnızca ses olan M4A/M4B de aynı kabı kullanır; bunlar video sayılmaz.
 */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'av01', 'hvc1', 'dash', 'msnv', 'mmp4', 'MSNV', 'XAVC',
  'M4V ', 'M4VH', 'M4VP', 'f4v ', '3gp4', '3gp5', '3gp6', '3g2a', 'kddi',
]);
const QUICKTIME_BRAND = 'qt  ';

/** Dosyanın başından video kabını tanır (MP4/QuickTime "ftyp", WebM/Matroska EBML); değilse null. */
export function inspectVideo(head: Buffer): VideoInfo | null {
  try {
    if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
      const size = head.readUInt32BE(0);
      if (size < 16 && size !== 0 && size !== 1) return null;
      const brand = head.toString('latin1', 8, 12);
      if (brand === QUICKTIME_BRAND) return { type: 'video/quicktime', width: null, height: null, duration: null };
      if (MP4_BRANDS.has(brand)) return { type: 'video/mp4', width: null, height: null, duration: null };
      return null;
    }
    if (head.length >= 4 && head.readUInt32BE(0) === EBML_MAGIC) return inspectMatroska(head);
  } catch {
    // bozuk başlık: video sayılmaz
  }
  return null;
}

/** Dosyanın herhangi bir yerinden okuma (MP4'te "moov" kutusu sonda olabilir) */
export type ReadAt = (position: number, length: number) => Promise<Buffer>;

export interface Mp4Metadata {
  /** Görüntü izi var mı (yoksa yalnızca ses: M4A gibi) */
  video: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
}

/** "moov" kutusu bundan büyükse okunmaz (25 MB'lık videolarda birkaç yüz KB olur) */
const MAX_MOOV_BYTES = 8 * 1024 * 1024;

/**
 * MP4/QuickTime'ın boyutunu ve süresini "moov" kutusundan okur: üst düzey kutuların başlıkları
 * atlanarak moov bulunur (telefon videolarında dosyanın sonundadır), yalnızca o okunur. Bulunamazsa null.
 */
export async function mp4Metadata(read: ReadAt, size: number): Promise<Mp4Metadata | null> {
  let pos = 0;
  for (let guard = 0; pos + 8 <= size && guard < 1000; guard++) {
    const header = await read(pos, 16);
    if (header.length < 8) break;
    let boxSize = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.length < 16) break;
      boxSize = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - pos; // dosyanın sonuna kadar
    }
    if (boxSize < headerSize) break;
    if (type === 'moov') {
      const length = boxSize - headerSize;
      if (length > MAX_MOOV_BYTES) return null;
      return parseMoov(await read(pos + headerSize, length));
    }
    pos += boxSize;
  }
  return null;
}

/** Bir kutunun alt kutuları: [tür, içeriğin başı, içeriğin sonu] */
function* boxes(b: Buffer, start: number, end: number): Generator<[string, number, number]> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = b.readUInt32BE(pos);
    const type = b.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(b.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield [type, pos + header, pos + size];
    pos += size;
  }
}

function parseMoov(b: Buffer): Mp4Metadata {
  const info: Mp4Metadata = { video: false, width: null, height: null, duration: null };
  try {
    for (const [type, start, end] of boxes(b, 0, b.length)) {
      if (type === 'mvhd' && end - start >= 20) {
        const v1 = b[start] === 1;
        const timescale = b.readUInt32BE(start + (v1 ? 20 : 12));
        const duration = v1 ? Number(b.readBigUInt64BE(start + 24)) : b.readUInt32BE(start + 16);
        if (timescale > 0 && duration > 0 && duration < 0xffffffff) {
          info.duration = Math.round((duration / timescale) * 1000) / 1000;
        }
      } else if (type === 'trak' && !info.video) {
        const track = parseTrak(b, start, end);
        if (track) {
          info.video = true;
          info.width = track.width;
          info.height = track.height;
        }
      }
    }
  } catch {
    // bozuk kutu: okunabilenler kalır
  }
  return info;
}

/** Görüntü izinin boyutu (tkhd), döndürme matrisi uygulanmış hâliyle; görüntü izi değilse null */
function parseTrak(
  b: Buffer,
  start: number,
  end: number,
): { width: number | null; height: number | null } | null {
  let size: { width: number | null; height: number | null } = { width: null, height: null };
  let video = false;
  for (const [type, s, e] of boxes(b, start, end)) {
    if (type === 'tkhd' && e - s >= 84) {
      const v1 = b[s] === 1;
      const matrix = s + (v1 ? 52 : 40);
      const at = s + (v1 ? 88 : 76);
      if (at + 8 > e) continue;
      let width = Math.round(b.readUInt32BE(at) / 65536);
      let height = Math.round(b.readUInt32BE(at + 4) / 65536);
      // 90°/270° döndürülmüş video (telefonla dik çekim): a = d = 0
      if (b.readInt32BE(matrix) === 0 && b.readInt32BE(matrix + 16) === 0) [width, height] = [height, width];
      if (width > 0 && height > 0) size = { width, height };
    } else if (type === 'mdia') {
      for (const [t, hs, he] of boxes(b, s, e)) {
        if (t === 'hdlr' && he - hs >= 12 && b.toString('latin1', hs + 8, hs + 12) === 'vide') video = true;
      }
    }
  }
  return video ? size : null;
}

// Matroska/WebM: EBML öğeleri (kimlik, boyut, içerik)
const EBML_MAGIC = 0x1a45dfa3;
const MKV = {
  docType: 0x4282,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
};

/** EBML değişken uzunluklu sayı: [değer, uzunluk]; kimliklerde işaret biti korunur. Bilinmeyen boyut: -1 */
function vint(b: Buffer, pos: number, keepMarker: boolean): [number, number] | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23; // 1–8
  if (pos + length > b.length || length > 8) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i]!;
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return [!keepMarker && allOnes ? -1 : value, length];
}

/** Öğeler: [kimlik, içeriğin başı, içeriğin sonu]; boyutu bilinmeyen öğe tamponun sonuna kadar sürer */
function* elements(b: Buffer, start: number, end: number): Generator<[number, number, number]> {
  let pos = start;
  while (pos < end) {
    const id = vint(b, pos, true);
    if (!id) return;
    const size = vint(b, pos + id[1], false);
    if (!size) return;
    const dataStart = pos + id[1] + size[1];
    const dataEnd = size[0] < 0 ? end : Math.min(end, dataStart + size[0]);
    yield [id[0], dataStart, dataEnd];
    if (size[0] < 0 || dataStart + size[0] > end) return;
    pos = dataEnd;
  }
}

const uint = (b: Buffer, start: number, end: number): number => {
  let value = 0;
  for (let i = start; i < end && i < start + 6; i++) value = value * 256 + b[i]!;
  return value;
};

function inspectMatroska(b: Buffer): VideoInfo | null {
  let docType = '';
  const info: VideoInfo = { type: 'video/webm', width: null, height: null, duration: null };
  for (const [id, start, end] of elements(b, 0, b.length)) {
    if (id === EBML_MAGIC) {
      for (const [child, s, e] of elements(b, start, end)) if (child === MKV.docType) docType = b.toString('latin1', s, e);
    } else if (id === MKV.segment) {
      readSegment(b, start, end, info);
    }
  }
  docType = docType.replace(/\0+$/, '');
  if (docType === 'webm') return info;
  if (docType === 'matroska') return { ...info, type: 'video/x-matroska' };
  return null;
}

function readSegment(b: Buffer, start: number, end: number, info: VideoInfo): void {
  let scale = 1_000_000;
  let rawDuration: number | null = null;
  for (const [id, s, e] of elements(b, start, end)) {
    if (id === MKV.cluster) break; // görüntü verisi başladı
    if (id === MKV.info) {
      for (const [child, cs, ce] of elements(b, s, e)) {
        if (child === MKV.timecodeScale) scale = uint(b, cs, ce) || scale;
        if (child === MKV.duration && ce - cs === 4) rawDuration = b.readFloatBE(cs);
        if (child === MKV.duration && ce - cs === 8) rawDuration = b.readDoubleBE(cs);
      }
    } else if (id === MKV.tracks) {
      for (const [entry, es, ee] of elements(b, s, e)) {
        if (entry !== MKV.trackEntry || info.width !== null) continue;
        let type = 0;
        let width: number | null = null;
        let height: number | null = null;
        for (const [child, cs, ce] of elements(b, es, ee)) {
          if (child === MKV.trackType) type = uint(b, cs, ce);
          if (child === MKV.video) {
            for (const [v, vs, ve] of elements(b, cs, ce)) {
              if (v === MKV.pixelWidth) width = uint(b, vs, ve);
              if (v === MKV.pixelHeight) height = uint(b, vs, ve);
            }
          }
        }
        if (type === 1 && width && height) {
          info.width = width;
          info.height = height;
        }
      }
    }
  }
  if (rawDuration !== null && Number.isFinite(rawDuration) && rawDuration > 0) {
    info.duration = Math.round(((rawDuration * scale) / 1e9) * 1000) / 1000;
  }
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

/**
 * Dosya sunulurken gönderilecek Content-Type. `inline`: türü içerikten belirlenmiş, tarayıcıda
 * gösterilen resim ya da video.
 */
export function servedType(contentType: string, inline: boolean): string {
  if (inline) return contentType;
  if (contentType === 'text/plain') return 'text/plain; charset=utf-8';
  return PASSIVE_TYPES.has(contentType) ? contentType : 'application/octet-stream';
}

/** RFC 6266: ASCII yedek ad ve UTF-8 asıl ad */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// ---------- HTTP Range (RFC 9110) ----------

/**
 * Range başlığının sonucu: `full` tüm dosya (başlık yok, bayt dışı birim ya da birden çok aralık;
 * bunlar yok sayılır), `range` tek aralık [start, end] (end dahil), `invalid` karşılanamaz ya da
 * bozuk aralık (416).
 */
export type RangeResult = { kind: 'full' } | { kind: 'range'; start: number; end: number } | { kind: 'invalid' };

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const eq = header.indexOf('=');
  if (eq < 0) return { kind: 'invalid' };
  if (header.slice(0, eq).trim().toLowerCase() !== 'bytes') return { kind: 'full' };
  const spec = header.slice(eq + 1).trim();
  // Birden çok aralık (multipart/byteranges) desteklenmez: tüm dosya gönderilir
  if (spec.includes(',')) return { kind: 'full' };
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'invalid' };
  if (m[1] === '') {
    // Son N bayt
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) return { kind: 'invalid' };
    return { kind: 'range', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || end < start) return { kind: 'invalid' };
  return { kind: 'range', start, end };
}
