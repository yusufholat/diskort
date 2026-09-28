// Bir görünümün bir karesi: setin gölgelendiricisi (SkSL'e çevrilmiş ortak kaynak) ve üstüne 2B katman.
// React Native'e bağlı değildir: motor (engine.ts) bir Skia resmine kaydederken, birim testleri CanvasKit
// üstünde aynı arayüzle (react-native-skia'nın web uygulaması) bir yüzeye çizerken kullanır.

import type { CosmeticSet } from '@diskort/shared';
import { SHADER_MODE } from '@diskort/client-core';
import type { Skia as SkiaApi, SkCanvas, SkRuntimeEffect } from '@shopify/react-native-skia';
import { drawFallback, drawPlateScrim, LAYERS, Pen, type LayerView } from './layers';
import { cosmeticSksl, packUniforms, uniformLayout, type CosmeticUniforms } from './sksl';

type Skia = typeof SkiaApi;

export interface CosmeticProgram {
  effect: SkRuntimeEffect;
  layout: ReturnType<typeof uniformLayout>;
}

/**
 * Setin gölgelendiricisini derler; derlenemezse null (2B yedek zemin çizilir). `lite`: gürültünün bir
 * katmanı atlanır (telefonda ağır görünümler için).
 */
export function compileCosmetic(S: Skia, set: CosmeticSet, lite = false): CosmeticProgram | null {
  const src = cosmeticSksl(set, lite ? { fbmOctaves: 4 } : {});
  const effect = S.RuntimeEffect.Make(src);
  return effect ? { effect, layout: uniformLayout(src) } : null;
}

const uniforms: CosmeticUniforms = { u_off: [0, 0], u_res: [0, 0], u_k: 1, u_time: 0, u_mode: 0, u_a: [0, 0, 0, 0] };
const packed: number[] = [];

/** Görünümün t anındaki karesini css pikseliyle (0, 0)–(w, h) içine çizer */
export function drawCosmetic(S: Skia, canvas: SkCanvas, v: LayerView & { set: CosmeticSet }, t: number, P: CosmeticProgram | null): void {
  const g = new Pen(S, canvas);
  if (P) {
    uniforms.u_res = [v.w, v.h];
    uniforms.u_time = t;
    uniforms.u_mode = SHADER_MODE[v.kind];
    uniforms.u_a = v.kind === 'card' ? [v.geo.bh, v.geo.ax, v.geo.ay, v.geo.ar] : [v.R, 0, 0, 0];
    const shader = P.effect.makeShader(packUniforms(P.layout, uniforms, packed));
    const rect = S.XYWHRect(0, 0, v.w, v.h);
    canvas.drawRect(rect, g.shade(shader, 1));
    g.r.paint.setShader(null);
    shader.dispose();
  } else drawFallback(g, v, v.set);
  LAYERS[v.set](g, v, t);
  // isim plakası: yazıların altı koyu ve sakin (masaüstündeki gibi en son)
  if (v.kind === 'plate') drawPlateScrim(g, v, v.set);
}
