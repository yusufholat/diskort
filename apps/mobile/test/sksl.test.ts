// GLSL → SkSL çevirisi: her setin çevrilmiş kaynağı Skia'nın kendi derleyicisiyle (CanvasKit, telefondaki
// Skia'nın WebAssembly derlemesi) derlenir ve küçük bir yüzeye çizilir.

import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { COSMETIC_SETS } from '@diskort/shared';
import { COSMETIC_SHADER_COMMON } from '@diskort/client-core';
import { cosmeticSksl, glslToSksl, packUniforms, uniformLayout } from '../src/components/cosmetics/sksl';

let CK: CanvasKit;

beforeAll(async () => {
  CK = await CanvasKitInit();
}, 60_000);

describe('glslToSksl', () => {
  it('tür adlarını, önişlemciyi ve yorumları çevirir', () => {
    const out = glslToSksl(
      'precision highp float;\n#define PI 3.14\n// yorum\nuniform vec2 a; mat2 m; vec4 f(vec3 c){return vec4(c*PI,1.);}',
    );
    expect(out).not.toMatch(/\bvec[234]\b|\bmat2\b|#define|precision|yorum/);
    expect(out).toContain('uniform float2 a;');
    expect(out).toContain('float2x2 m;');
    expect(out).toContain('float4 f(float3 c){return float4(c*(3.14),1.);}');
  });

  it('giriş noktası Skia biçiminde, GL değişkenleri kalmaz', () => {
    const src = cosmeticSksl('sakura');
    expect(src).toMatch(/half4 main\(float2 sk_xy\)/);
    expect(src).not.toMatch(/gl_Frag|void main/);
    expect(src).toMatch(/return half4\(/);
  });

  it('fbm katman sayısı değiştirilebilir (kaynakta bulunamazsa olduğu gibi kalır)', () => {
    expect(COSMETIC_SHADER_COMMON).toMatch(/float fbm\(vec2 p\)/);
    const four = cosmeticSksl('karadelik', { fbmOctaves: 4 });
    expect(four).toMatch(/float fbm\(float2 p\)\{[^}]*i<4;/);
    expect(four).toContain('return s/0.9375;');
    expect(cosmeticSksl('karadelik')).toMatch(/float fbm\(float2 p\)\{[^}]*i<5;/);
  });

  it('uniform sırası kaynaktan okunur ve dizi buna göre dolar', () => {
    const layout = uniformLayout(cosmeticSksl('neon'));
    expect(layout).toEqual([
      ['u_off', 2],
      ['u_res', 2],
      ['u_k', 1],
      ['u_time', 1],
      ['u_mode', 1],
      ['u_a', 4],
    ]);
    const arr = packUniforms(layout, { u_off: [0, 0], u_res: [10, 20], u_k: 1, u_time: 3, u_mode: 2, u_a: [5, 6, 7, 8] });
    expect(arr).toEqual([0, 0, 10, 20, 1, 3, 2, 5, 6, 7, 8]);
  });
});

describe('Skia derleyicisi', () => {
  for (const set of COSMETIC_SETS) {
    for (const lite of [false, true]) {
      it(`${set}${lite ? ' (4 katman fbm)' : ''} derlenir ve her görünüm türünde çizilir`, () => {
        const src = cosmeticSksl(set, lite ? { fbmOctaves: 4 } : {});
        const errors: string[] = [];
        const effect = CK.RuntimeEffect.Make(src, (e) => errors.push(e));
        expect(errors, errors.join('\n')).toEqual([]);
        expect(effect).not.toBeNull();
        const layout = uniformLayout(src);
        expect(effect!.getUniformFloatCount()).toBe(layout.reduce((n, [, s]) => n + s, 0));
        // her mod (küçük resim, kart, plaka, dekorasyon) bir kez çizilir; boş olmamalı
        for (const [mode, w, h, a] of [
          [0, 64, 40, [0, 0, 0, 0]],
          [1, 80, 120, [50, 30, 50, 20]],
          [2, 120, 24, [0, 0, 0, 0]],
          [3, 60, 60, [20, 0, 0, 0]],
        ] as const) {
          const shader = effect!.makeShader(
            packUniforms(layout, { u_off: [0, 0], u_res: [w, h], u_k: 1, u_time: 8.4, u_mode: mode, u_a: a }),
          );
          const surface = CK.MakeSurface(w, h)!;
          const paint = new CK.Paint();
          paint.setShader(shader);
          surface.getCanvas().drawPaint(paint);
          const img = surface.makeImageSnapshot();
          const px = img.readPixels(0, 0, {
            width: w,
            height: h,
            colorType: CK.ColorType.RGBA_8888,
            alphaType: CK.AlphaType.Premul,
            colorSpace: CK.ColorSpace.SRGB,
          });
          expect(px).not.toBeNull();
          let sum = 0;
          for (let i = 0; i < px!.length; i++) sum += px![i]!;
          expect(sum, `mod ${mode} boş çizildi`).toBeGreaterThan(0);
          img.delete();
          paint.delete();
          shader.delete();
          surface.delete();
        }
        effect!.delete();
      });
    }
  }
});
