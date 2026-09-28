// Kozmetik karelerinin tamamı (gölgelendirici + 2B katman + plaka perdesi): react-native-skia'nın web
// uygulaması (CanvasKit üstünde telefondakiyle aynı Skia arayüzü) ile Node'da bir yüzeye çizilir. Telefonda
// denenemeyen çizim kodunun her set ve görünüm türünde hatasız çalıştığını ve boş kalmadığını denetler.

import CanvasKitInit from 'canvaskit-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { COSMETIC_SETS, type CosmeticSet } from '@diskort/shared';
import type { ShaderViewKind } from '@diskort/client-core';
import type { Skia as SkiaApi } from '@shopify/react-native-skia';
import { JsiSkApi } from '@shopify/react-native-skia/lib/module/skia/web/JsiSkia';
import { compileCosmetic, drawCosmetic, type CosmeticProgram } from '../src/components/cosmetics/draw';
import { armPoint, buildDendrites, iceG, type LayerView } from '../src/components/cosmetics/layers';

let S: typeof SkiaApi;

beforeAll(async () => {
  const CK = await CanvasKitInit();
  S = JsiSkApi(CK) as unknown as typeof SkiaApi;
}, 60_000);

/** Görünüm türlerinin denemedeki boyutları (telefondaki yaklaşık boylar) */
const SIZES: Record<ShaderViewKind, [number, number]> = {
  thumb: [160, 100],
  card: [300, 260],
  plate: [300, 42],
  deco: [101, 101],
};

function view(kind: ShaderViewKind, set: CosmeticSet): LayerView & { set: CosmeticSet } {
  const [w, h] = SIZES[kind];
  return { kind, set, w, h, cache: new Map(), geo: { bh: 106, ax: 62, ay: 112, ar: 44 }, R: 35 };
}

/** Kareyi çizer, yüzeyin piksellerinin toplamını döndürür */
function render(v: LayerView & { set: CosmeticSet }, t: number, P: CosmeticProgram | null): number {
  const surface = S.Surface.Make(v.w, v.h)!;
  const canvas = surface.getCanvas();
  drawCosmetic(S, canvas, v, t, P);
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels()!;
  let sum = 0;
  for (let i = 0; i < px.length; i++) sum += px[i]!;
  surface.dispose();
  return sum;
}

describe('kozmetik kareleri', () => {
  for (const set of COSMETIC_SETS) {
    it(`${set}: her görünüm türü gölgelendiriciyle ve 2B yedekle çizilir`, () => {
      const P = compileCosmetic(S, set);
      expect(P).not.toBeNull();
      for (const kind of Object.keys(SIZES) as ShaderViewKind[]) {
        const v = view(kind, set);
        // iki an: buz büyürken (dendritler kırpılarak) ve erirken, sakuranın döngüsünün iki ucu
        for (const t of [3.3, 12.9]) expect(render(v, t, P), `${kind} t=${t}`).toBeGreaterThan(0);
        expect(render(view(kind, set), 8.4, null), `${kind} yedek`).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});

describe('buz dendritleri', () => {
  it('kolların uçları parçaların uçlarıyla aynı yerde (kırpma ile açılan yol masaüstündekiyle aynı)', () => {
    const D = buildDendrites([{ x: 0, y: 0, a: 0.78, len: 60 }], 7, 2);
    expect(D.arms.length).toBeGreaterThan(1);
    for (const a of D.arms) {
      const own = D.segs.filter((s) => s.d === a.d && s.b0 >= a.birth - 1e-9 && s.b1 <= a.birth + a.len + 1e-9);
      expect(own.length).toBeGreaterThan(0);
      const end = armPoint(a, 1);
      expect(own.some((s) => Math.hypot(s.x2 - end[0], s.y2 - end[1]) < 1e-6)).toBe(true);
    }
    expect(iceG(0)).toBe(0);
    expect(iceG(8)).toBe(1);
  });
});
