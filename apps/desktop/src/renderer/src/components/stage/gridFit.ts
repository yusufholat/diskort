/** Izgara kutucuğunun en büyük genişliği (px) */
export const TILE_MAX_W = 720;

/**
 * Alana sığan en büyük 16:9 kutucuk için sütun sayısı ve kutucuk genişliği (px). Her sütun sayısı denenir,
 * kutucuğu en büyük yapan seçilir; genişlik TILE_MAX_W'yi geçmez.
 */
export function fitGrid(count: number, width: number, height: number, gap: number): { cols: number; tileW: number } {
  const n = Math.max(1, count);
  let cols = 1;
  let best = -Infinity;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const byW = (width - gap * (c - 1)) / c;
    const byH = ((height - gap * (rows - 1)) / rows) * (16 / 9);
    const w = Math.min(byW, byH);
    if (w > best) {
      best = w;
      cols = c;
    }
  }
  return { cols, tileW: Math.max(0, Math.floor(Math.min(best, TILE_MAX_W))) };
}
