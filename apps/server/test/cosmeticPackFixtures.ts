import type { CosmeticAssetKind, CosmeticPiece } from '@diskort/shared';

// Kozmetik paketi testleri için en küçük geçerli dosyalar: kapların yalnızca sunucunun baktığı kısımları
// (imza, kutu yapısı, boyutlar) kurulur; piksel verisi yoktur.

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

/** ISO-BMFF kutusu */
export const box = (type: string, ...payload: Buffer[]): Buffer => {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};

/** WebP (VP8X başlıklı): `animated` hareket bayrağı, `padding` dosyayı büyütmek için ek parça */
export function webp(width: number, height: number, animated = false, padding = 0): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x10 | (animated ? 0x02 : 0);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunks = [Buffer.from('VP8X'), u32le(10), vp8x];
  // RIFF parçaları çift uzunlukludur
  const pad = padding + (padding % 2);
  if (pad > 0) chunks.push(Buffer.from('EXIF'), u32le(pad), Buffer.alloc(pad));
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}

/** AVIF: `sequence` hareketli (görüntü dizisi: "avis" markası ve moov kutusu) */
export function avif(width: number, height: number, sequence = true): Buffer {
  const ftyp = box('ftyp', Buffer.from(sequence ? 'avis' : 'avif'), u32(0), Buffer.from('avifmif1miaf'));
  const meta = box('meta', u32(0), box('iprp', box('ipco', box('ispe', u32(0), u32(width), u32(height)))));
  const moov = sequence ? [box('moov', box('mvhd', Buffer.alloc(100)))] : [];
  return Buffer.concat([ftyp, meta, ...moov, box('mdat', Buffer.from('kareler'))]);
}

/** MP4: tek görüntü izi (`width`×`height`), örnek girişi `codec` (H.264: avcC) */
export function mp4(width: number, height: number, codec = 'avcC'): Buffer {
  const tkhd = Buffer.alloc(84);
  // Birim matris (döndürme yok)
  tkhd.writeInt32BE(0x00010000, 40);
  tkhd.writeInt32BE(0x00010000, 56);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const hdlr = Buffer.concat([u32(0), u32(0), Buffer.from('vide'), Buffer.alloc(12)]);
  const entry = box(codec === 'avcC' ? 'avc1' : 'hvc1', Buffer.alloc(78), box(codec, Buffer.from([1, 0x64, 0, 0x1f])));
  const stbl = box('stbl', box('stsd', u32(0), u32(1), entry));
  const trak = box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', hdlr), box('minf', stbl)));
  const moov = box('moov', box('mvhd', Buffer.alloc(100)), trak);
  return Buffer.concat([box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso2avc1mp41')), moov, box('mdat', Buffer.alloc(64))]);
}

export interface BundleFile {
  piece: CosmeticPiece;
  kind: CosmeticAssetKind;
  name: string;
  width: number;
  height: number;
  stackedWidth?: number;
  alphaX?: number;
  data: string;
}

export const file = (
  piece: CosmeticPiece,
  kind: CosmeticAssetKind,
  name: string,
  width: number,
  height: number,
  content: Buffer,
  extra: { stackedWidth?: number; alphaX?: number } = {},
): BundleFile => ({ piece, kind, name, width, height, ...extra, data: content.toString('base64') });

/** Parçaların görünen boyutları */
export const SIZES: Record<CosmeticPiece, [number, number]> = { card: [600, 900], deco: [264, 264], plate: [480, 84] };

/** Üç parçası da tam (avif + yan yana video + poster) geçerli dosya listesi; `seed` içeriği (dolayısıyla sürümü) değiştirir */
export function fullFiles(seed = 0): BundleFile[] {
  return (['card', 'deco', 'plate'] as const).flatMap((piece) => {
    const [w, h] = SIZES[piece];
    const stackedWidth = 2 * w + 16;
    return [
      file(piece, 'avif', `${piece}.avif`, w, h, avif(w, h)),
      file(piece, 'stacked-h264', `${piece}.mp4`, w, h, mp4(stackedWidth, h), { stackedWidth, alphaX: w + 16 }),
      file(piece, 'poster', `${piece}-poster.webp`, w, h, webp(w, h, false, seed)),
    ];
  });
}

export const packInfo = (id = 'buz', overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  label: 'Kristal Buz',
  accent: '#9fe6ff',
  from: '#0b2a44',
  to: '#6fb3d9',
  fallback: ['#04101c', '#2a5d80', 'rgba(180,235,255,.35)'],
  description: 'Buz köşelerden dallanarak büyür.',
  pieces: ['Kırağı', 'Kristaller', 'Satıra yayılan kırağı'],
  loopSeconds: 6,
  fps: 30,
  platforms: ['desktop'],
  ...overrides,
});

export const bundle = (
  id = 'buz',
  overrides: Record<string, unknown> = {},
  files: BundleFile[] = fullFiles(),
): { format: number; pack: Record<string, unknown>; files: BundleFile[] } => ({ format: 1, pack: packInfo(id, overrides), files });
