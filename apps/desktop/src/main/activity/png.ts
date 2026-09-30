// Etkinlik ikonunun PNG'si: sunucu yalnızca kare, 16–128 px, en fazla 64 KB ve yalnızca temel parçalardan
// oluşan PNG kabul eder. Anahtar, yüklenen baytların SHA-256'sı olduğundan ayıklama anahtardan önce yapılır.
import { createHash } from 'node:crypto';
import { ACTIVITY_ICON_MAX_BYTES, ACTIVITY_ICON_MAX_SIZE_PX } from '@diskort/shared';

export const ACTIVITY_ICON_MIN_SIZE_PX = 16;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Sunucunun kabul ettiği parçalar (metin, animasyon ve özel parçalar atılır) */
const ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'sRGB', 'pHYs']);

/** PNG'nin parça adları (bozuksa null) */
export function pngChunks(png: Buffer): { type: string; start: number; end: number }[] | null {
  if (png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null;
  const chunks: { type: string; start: number; end: number }[] = [];
  let at = SIGNATURE.length;
  while (at < png.length) {
    if (at + 12 > png.length) return null;
    const end = at + 12 + png.readUInt32BE(at);
    if (end > png.length) return null;
    const type = png.toString('latin1', at + 4, at + 8);
    chunks.push({ type, start: at, end });
    at = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

/**
 * İkonu sunucunun kabul edeceği hâle getirir: izin verilmeyen parçalar atılır (görüntü değişmez). Kare
 * değilse, boyutu sınırların dışındaysa ya da dosya bozuksa null.
 */
export function sanitizeIconPng(png: Buffer): Buffer | null {
  const chunks = pngChunks(png);
  if (!chunks || chunks[0]?.type !== 'IHDR' || chunks[0].end - chunks[0].start !== 25) return null;
  if (chunks[chunks.length - 1]!.type !== 'IEND' || !chunks.some((c) => c.type === 'IDAT')) return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== height || width < ACTIVITY_ICON_MIN_SIZE_PX || width > ACTIVITY_ICON_MAX_SIZE_PX) return null;
  const kept = chunks.filter((c) => ALLOWED_CHUNKS.has(c.type));
  const clean = kept.length === chunks.length && chunks[chunks.length - 1]!.end === png.length
    ? png
    : Buffer.concat([SIGNATURE, ...kept.map((c) => png.subarray(c.start, c.end))]);
  return clean.length <= ACTIVITY_ICON_MAX_BYTES ? clean : null;
}

/** İkonun anahtarı: baytlarının SHA-256'sı (küçük harf onaltılık) */
export const iconKeyOf = (png: Buffer): string => createHash('sha256').update(png).digest('hex');
