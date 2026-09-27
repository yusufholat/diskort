import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_IDS, THEME_PALETTES, THEME_TOKENS, type ThemePalette } from '../src/shared/themes.js';

/** '#rrggbb' → göreli parlaklık (WCAG) */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`düz renk değil: ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** [ön plan, zemin, en düşük oran] */
const CHECKS: [keyof ThemePalette, keyof ThemePalette | '#ffffff', number][] = [
  ['text-normal', 'bg-main', 7],
  ['text-normal', 'bg-side', 7],
  ['text-head', 'bg-float', 7],
  ['text-muted', 'bg-main', 4.5],
  ['text-muted', 'bg-side', 4.5],
  ['text-muted', 'bg-float', 4.5],
  ['text-faint', 'bg-main', 3.5],
  ['text-faint', 'bg-side', 3.5],
  ['text-normal', 'msg-hover', 7],
  ['text-muted', 'msg-hover', 4.5],
  ['text-normal', 'bg-active', 4.5],
  ['text-normal', 'bg-input', 7],
  ['link', 'bg-main', 4.5],
  ['link', 'bg-side', 4.5],
  ['danger-text', 'bg-main', 4.5],
  ['ok-text', 'bg-main', 4.5],
  ['mention', 'bg-main', 4.5],
  ['#ffffff' as keyof ThemePalette, 'brand', 4.2],
  ['#ffffff' as keyof ThemePalette, 'brand-hover', 4.5],
  ['on-control', 'control', 4.5],
  ['text-head', 'bg-raised', 7],
];

const color = (p: ThemePalette, k: string): string => (k.startsWith('#') ? k : p[k as keyof ThemePalette]);

describe('temalar', () => {
  for (const id of THEME_IDS) {
    const p = THEME_PALETTES[id];
    it(`${id}: tüm belirteçler tanımlı`, () => {
      for (const t of THEME_TOKENS) expect(p[t], t).toBeTruthy();
    });
    it(`${id}: okunabilirlik oranları`, () => {
      const failures = CHECKS.map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(color(p, fg), color(p, bg)) }))
        .filter((c) => c.ratio < c.min)
        .map((c) => `${c.fg} / ${c.bg}: ${c.ratio.toFixed(2)} < ${c.min}`);
      expect(failures).toEqual([]);
    });
    it(`${id}: mesaj üstüne gelme ve kenarlar zeminden ayırt edilir`, () => {
      expect(p['msg-hover']).not.toBe(p['bg-main']);
      expect(contrast(p.line, p['bg-main'])).toBeGreaterThan(1.2);
      expect(contrast(p['bg-active'], p['bg-side'])).toBeGreaterThan(1.1);
    });
  }

  it("styles.css'teki @theme varsayılanları varsayılan temayla aynı", () => {
    const css = readFileSync(path.join(__dirname, '../src/renderer/src/styles.css'), 'utf8');
    const block = /@theme\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
    const p = THEME_PALETTES[DEFAULT_THEME];
    for (const t of THEME_TOKENS) {
      const m = new RegExp(`--color-${t}:\\s*([^;]+);`).exec(block);
      expect(m?.[1].trim(), t).toBe(p[t]);
    }
  });
});
