import { describe, expect, it } from 'vitest';
import { fitGrid, TILE_MAX_W } from '../src/renderer/src/components/stage/gridFit.js';

describe('ses sahnesi ızgarası', () => {
  it('geniş alanda 3 kutucuk 2 sütun olur (son satır ortada), genişlik yüksekliğe göre', () => {
    const { cols, tileW } = fitGrid(3, 1500, 700, 12);
    expect(cols).toBe(2);
    // İki satır 700 px'e sığmalı
    expect(2 * (tileW * 9) / 16 + 12).toBeLessThanOrEqual(700);
    expect(tileW).toBeLessThanOrEqual(TILE_MAX_W);
  });

  it('kutucuk alana taşmaz ve en çok TILE_MAX_W olur', () => {
    for (const [n, w, h] of [
      [1, 3000, 2000],
      [2, 3000, 2000],
      [5, 900, 600],
      [7, 1200, 400],
      [12, 800, 800],
    ] as const) {
      const { cols, tileW } = fitGrid(n, w, h, 12);
      const rows = Math.ceil(n / cols);
      expect(cols * tileW + (cols - 1) * 12).toBeLessThanOrEqual(w);
      expect(rows * ((tileW * 9) / 16) + (rows - 1) * 12).toBeLessThanOrEqual(h + 1);
      expect(tileW).toBeLessThanOrEqual(TILE_MAX_W);
    }
  });

  it('dar ve uzun alanda tek sütun', () => {
    expect(fitGrid(3, 400, 1200, 12).cols).toBe(1);
  });

  it('ölçü yokken sıfır genişlik', () => {
    expect(fitGrid(2, 0, 0, 12).tileW).toBe(0);
  });
});
