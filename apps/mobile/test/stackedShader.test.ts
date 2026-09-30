// Yan yana videonun birleştirme gölgelendiricisi Skia'nın kendi derleyicisiyle (CanvasKit: telefondaki Skia'nın
// WebAssembly derlemesi) derlenir ve küçük, yapay bir "yan yana" kareyle denenir: çıktının rengi soldaki
// yarıdan, saydamlığı sağdaki yarıdan gelmeli; renk alfanın üstüne taşarsa kırpılmalı; ölçekli çizimde doğru
// pikseller okunmalı.

import CanvasKitInit, { type CanvasKit, type Image, type RuntimeEffect } from 'canvaskit-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STACKED_ALPHA_SKSL, stackedUniforms, type StackedLayout } from '../src/components/cosmetics/packLayout';

let CK: CanvasKit;
let effect: RuntimeEffect;
let frame: Image;

// Görünen kare 4×2; aralarında 2 piksellik boşlukla toplam 10 piksel genişlik
const layout: StackedLayout = { width: 4, height: 2, stackedWidth: 10, alphaX: 6 };

/** Görünen karenin pikselleri: [önceden çarpılmış r, g, b, alfa] */
const pixels: [number, number, number, number][][] = [
  [
    [255, 0, 0, 255],
    [0, 128, 0, 128],
    [0, 0, 0, 0],
    [40, 40, 40, 64],
  ],
  [
    [0, 0, 255, 255],
    // Sıkıştırma hatası gibi: renk alfanın üstünde (200 > 100): kırpılmalı
    [200, 50, 10, 100],
    [10, 20, 30, 255],
    [0, 0, 0, 0],
  ],
];

beforeAll(async () => {
  CK = await CanvasKitInit();
  const errors: string[] = [];
  const made = CK.RuntimeEffect.Make(STACKED_ALPHA_SKSL, (e) => errors.push(e));
  expect(errors, errors.join('\n')).toEqual([]);
  effect = made!;

  // Video karesi: solda renk, sağda gri tonlu alfa; boşluk ve alfa yarısı opak (video saydam değildir)
  const data = new Uint8Array(layout.stackedWidth * layout.height * 4);
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.stackedWidth; x++) {
      const o = (y * layout.stackedWidth + x) * 4;
      if (x < layout.width) {
        const [r, g, b] = pixels[y]![x]!;
        data.set([r, g, b, 255], o);
      } else if (x >= layout.alphaX) {
        const a = pixels[y]![x - layout.alphaX]![3];
        data.set([a, a, a, 255], o);
      } else data.set([255, 0, 255, 255], o); // boşluk: hiç okunmamalı
    }
  }
  frame = CK.MakeImage(
    { width: layout.stackedWidth, height: layout.height, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Opaque, colorSpace: CK.ColorSpace.SRGB },
    data,
    layout.stackedWidth * 4,
  )!;
}, 60_000);

afterAll(() => {
  frame?.delete();
  effect?.delete();
});

/** Kareyi w×h'lik saydam yüzeye birleştirerek çizer, pikselleri (önceden çarpılmış RGBA) döner */
function composite(w: number, h: number): Uint8Array {
  const u = stackedUniforms(layout, w, h);
  // Uygulamadaki gibi: alt gölgelendirici videonun kendi pikselleriyle örneklenir
  const child = frame.makeShaderOptions(CK.TileMode.Decal, CK.TileMode.Decal, CK.FilterMode.Nearest, CK.MipmapMode.None);
  // Değişkenlerin sırası kaynaktaki bildirim sırası: scale, size, alphaX
  const shader = effect.makeShaderWithChildren([...u.scale, ...u.size, u.alphaX], [child]);
  const surface = CK.MakeSurface(w, h)!;
  const paint = new CK.Paint();
  paint.setShader(shader);
  const canvas = surface.getCanvas();
  canvas.clear(CK.TRANSPARENT);
  canvas.drawRect(CK.XYWHRect(0, 0, w, h), paint);
  const image = surface.makeImageSnapshot();
  const out = image.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  image.delete();
  paint.delete();
  shader.delete();
  child.delete();
  surface.delete();
  return out;
}

const at = (px: Uint8Array, w: number, x: number, y: number): number[] => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('yan yana video gölgelendiricisi', () => {
  it('derlenir: bir alt gölgelendirici, beş sayı', () => {
    expect(effect).not.toBeNull();
    expect(effect.getUniformFloatCount()).toBe(5);
    expect(effect.getUniformCount()).toBe(3);
    expect(effect.getUniformName(0)).toBe('scale');
    expect(effect.getUniformName(1)).toBe('size');
    expect(effect.getUniformName(2)).toBe('alphaX');
  });

  it('piksel piksele: renk soldaki yarıdan, saydamlık sağdaki yarıdan', () => {
    const out = composite(layout.width, layout.height);
    expect(at(out, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(out, 4, 1, 0)).toEqual([0, 128, 0, 128]);
    expect(at(out, 4, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(at(out, 4, 3, 0)).toEqual([40, 40, 40, 64]);
    expect(at(out, 4, 0, 1)).toEqual([0, 0, 255, 255]);
    expect(at(out, 4, 2, 1)).toEqual([10, 20, 30, 255]);
    expect(at(out, 4, 3, 1)).toEqual([0, 0, 0, 0]);
  });

  it('renk alfanın üstüne taşarsa kırpılır (saydam yerde parlama olmaz)', () => {
    const out = composite(layout.width, layout.height);
    expect(at(out, 4, 1, 1)).toEqual([100, 50, 10, 100]);
  });

  it('boşluğun rengi hiçbir piksele karışmaz', () => {
    const out = composite(layout.width, layout.height);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const [r, g, b, a] = at(out, 4, x, y);
        expect([r, g, b, a]).toEqual([Math.min(pixels[y]![x]![0], a!), Math.min(pixels[y]![x]![1], a!), Math.min(pixels[y]![x]![2], a!), pixels[y]![x]![3]]);
      }
    }
  });

  it('büyütülmüş çizimde her çıktı pikseli kaynağındaki pikseli okur', () => {
    const w = layout.width * 3;
    const h = layout.height * 3;
    const out = composite(w, h);
    // Kaynağın (1, 0) pikseli çıktıda (3–5, 0–2): ortası
    expect(at(out, w, 4, 1)).toEqual([0, 128, 0, 128]);
    // Sağ alt köşe: kaynağın (3, 1) pikseli (saydam); sağındaki boşluk ve alfa yarısı karışmaz
    expect(at(out, w, w - 1, h - 1)).toEqual([0, 0, 0, 0]);
    // Sol üst köşe
    expect(at(out, w, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});
