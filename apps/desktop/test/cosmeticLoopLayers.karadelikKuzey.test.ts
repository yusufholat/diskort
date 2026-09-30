// Karadelik ve Kuzey Işıkları'nın 2B katmanlarının döngü biçimi (layers.ts drawKaradelikLoop, drawAuroraLoop):
// gerçek katman kodu, çizim çağrılarını kaydeden sahte bir 2B bağlamla çalıştırılır (tuval gerekmez).
// - döngüsellik: t ile t + döngü süresi aynı çizimi verir (5, 6, 7 sn);
// - süreklilik: hiçbir şey tek karede belirmez, kaybolmaz ya da yer değiştirmez (çok sık örneklenen zamanda
//   çizimlerin toplam örtücülüğü ve ağırlık merkezi küçük adımlarla değişir; bir sıçrama adımı küçültünce
//   küçülmez, bu yüzden yakalanır).

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LayerView } from '../src/renderer/src/components/cosmetics/layers.js';

type Layer = (ctx: CanvasRenderingContext2D, v: LayerView, t: number) => void;

/** Bir karenin özeti: çizim türü başına toplam örtücülük ve örtücülükle ağırlıklı konum toplamı */
interface Summary {
  ops: string[];
  sprite: [number, number, number];
  stroke: [number, number, number];
  fill: [number, number, number];
}

const round = (x: unknown): unknown => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : typeof x === 'object' ? '[nesne]' : x);

/** Çağrıları kaydeden sahte 2B bağlam (yalnızca katmanların kullandığı kadar) */
function fakeContext(record = true): { ctx: CanvasRenderingContext2D; take: () => Summary } {
  let sum: Summary = { ops: [], sprite: [0, 0, 0], stroke: [0, 0, 0], fill: [0, 0, 0] };
  const state: Record<string, unknown> = { globalAlpha: 1 };
  /** Geçerli yolun noktaları (ağırlık merkezi için) */
  let path: [number, number][] = [];
  const add = (into: [number, number, number], x: number, y: number): void => {
    const a = state.globalAlpha as number;
    into[0] += a;
    into[1] += a * x;
    into[2] += a * y;
  };
  const centre = (): [number, number] => {
    if (path.length === 0) return [0, 0];
    return [path.reduce((s, p) => s + p[0], 0) / path.length, path.reduce((s, p) => s + p[1], 0) / path.length];
  };
  const gradient = { addColorStop: () => {} };
  const methods: Record<string, (...args: number[]) => unknown> = {
    beginPath: () => void (path = []),
    moveTo: (x, y) => void path.push([x!, y!]),
    lineTo: (x, y) => void path.push([x!, y!]),
    closePath: () => {},
    stroke: () => add(sum.stroke, ...centre()),
    fill: () => add(sum.fill, ...centre()),
    drawImage: (_img, x, y, w, h) => add(sum.sprite, x! + w! / 2, y! + h! / 2),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {},
    setTransform: () => {},
  };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      const fn = methods[key];
      if (!fn && key in target) return target[key];
      // bilinmeyen çağrı (ör. başka bir çizim komutu) da kaydedilir, bir şey yapmaz
      return (...args: number[]) => {
        // tarama sırasında (record = false) çağrının metni gerekmez, yalnızca sayısı
        sum.ops.push(record ? `${key}(${args.map(round).join(',')})@${round(state.globalAlpha)}` : key);
        return fn?.(...args);
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    take: () => {
      const out = sum;
      sum = { ops: [], sprite: [0, 0, 0], stroke: [0, 0, 0], fill: [0, 0, 0] };
      return out;
    },
  };
}

/** Çizim aracının parçaları (scripts/cosmetic-render/render.mjs PIECE_SPECS) ve küçük resim */
function view(kind: LayerView['kind'], loop: number | undefined): LayerView {
  const base = { dpr: 2, cache: new Map<string, unknown>(), geo: { bh: 106, ax: 0, ay: 0, ar: -100 }, R: 46, loop };
  if (kind === 'deco') return { ...base, kind, w: 132, h: 132 };
  if (kind === 'plate') return { ...base, kind, w: 223, h: 40 };
  if (kind === 'card') return { ...base, kind, w: 300, h: 540 };
  return { ...base, kind, w: 160, h: 100 };
}

const KINDS: LayerView['kind'][] = ['deco', 'plate', 'card', 'thumb'];
const PERIODS = [5, 6, 7];
let LAYERS: Record<'karadelik' | 'kuzey', Layer>;

beforeAll(async () => {
  // layers.ts yüklenirken Path2D kurar, ilk çizimde parıltı resimleri için tuval ister
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
    },
  );
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext().ctx }) });
  LAYERS = (await import('../src/renderer/src/components/cosmetics/layers.js')).LAYERS;
});

function draw(set: 'karadelik' | 'kuzey', v: LayerView, t: number, record = true): Summary {
  const { ctx, take } = fakeContext(record);
  LAYERS[set](ctx, v, t);
  return take();
}

const METRICS = ['sprite', 'stroke', 'fill'] as const;

/** İki özetin farkı: tür başına örtücülük ve (görünüm boyutuna oranla) ağırlıklı konum farklarının en büyüğü */
function change(a: Summary, b: Summary, size: number): number {
  let d = 0;
  for (const m of METRICS) d = Math.max(d, Math.abs(a[m][0] - b[m][0]), Math.abs(a[m][1] - b[m][1]) / size, Math.abs(a[m][2] - b[m][2]) / size);
  return d;
}

/**
 * Sıçrama arar: döngü (dikiş dahil) 1/300 sn'lik adımlarla taranır, en büyük değişimin olduğu adımlar 8'e
 * bölünüp yeniden ölçülür. Sürekli bir değişim bölününce küçülür (her parça ~1/8); tek bir anda beliren,
 * kaybolan ya da yer değiştiren öğe ise bölünen parçalardan birinde olduğu gibi kalır. Dönen: sıçrama sayılan
 * adımlar (boşsa temiz).
 */
function findJumps(layer: (t: number) => Summary, P: number, size: number): { jumps: string[]; worst: number; drawn: number } {
  const STEPS = 300;
  const n = Math.round(P * STEPS);
  const at = (i: number): number => (i % n) / STEPS;
  const steps: { i: number; d: number }[] = [];
  let prev = layer(0);
  let drawn = prev.ops.length;
  for (let i = 1; i <= n; i++) {
    const cur = layer(at(i));
    drawn += cur.ops.length;
    steps.push({ i, d: change(prev, cur, size) });
    prev = cur;
  }
  steps.sort((a, b) => b.d - a.d);
  const jumps: string[] = [];
  for (const s of steps.slice(0, 12)) {
    if (s.d < 0.004) break;
    const t0 = (s.i - 1) / STEPS;
    let sub = 0;
    let p = layer(t0);
    for (let k = 1; k <= 8; k++) {
      // son adımın sonu dikişin öte yanı: t = 0
      const q = layer(k === 8 ? at(s.i) : t0 + k / 8 / STEPS);
      sub = Math.max(sub, change(p, q, size));
      p = q;
    }
    if (sub > 0.4 * s.d + 0.002) jumps.push(`t=${t0.toFixed(4)}: adım ${s.d.toFixed(4)}, sekizde biri ${sub.toFixed(4)}`);
  }
  return { jumps, worst: steps[0]?.d ?? 0, drawn };
}

describe('sıçrama denetimi', () => {
  const sprite = (alpha: number, x: number): Summary => ({ ops: ['x'], sprite: [alpha, alpha * x, 0], stroke: [0, 0, 0], fill: [0, 0, 0] });
  it('tek karede beliren, kaybolan ya da yer değiştiren öğeyi yakalar; yumuşak olanı geçirir', () => {
    // yumuşak: 0.1 sn'de belirir, hızla kayar
    expect(findJumps((t) => sprite(Math.min(1, t / 0.1) * Math.min(1, (6 - t) / 0.1), 40 * t), 6, 300).jumps).toEqual([]);
    // t = 2'de bir anda belirir (örtücülük 0.15)
    expect(findJumps((t) => sprite(t >= 2 ? 0.15 : 0, 10), 6, 300).jumps.length).toBeGreaterThan(0);
    // dikişte kaybolur: döngünün sonunda hâlâ görünür, başında yok
    expect(findJumps((t) => sprite(Math.min(1, t / 0.5), 10), 6, 300).jumps.length).toBeGreaterThan(0);
    // görünürken bir anda başka yere geçer
    expect(findJumps((t) => sprite(0.5, t < 3 ? 10 : 200), 6, 300).jumps.length).toBeGreaterThan(0);
  });
});

describe.each(['karadelik', 'kuzey'] as const)('%s: 2B katmanın döngü biçimi', (set) => {
  it('t ile t + döngü süresi aynı çizimi verir (5, 6, 7 sn; her parça)', () => {
    for (const P of PERIODS) {
      for (const kind of KINDS) {
        const v = view(kind, P);
        for (const t of [0, 0.37, P * 0.25, P * 0.5, P * 0.731, P - 0.01]) {
          expect(draw(set, v, t + P).ops).toEqual(draw(set, v, t).ops);
          expect(draw(set, v, t + 3 * P).ops).toEqual(draw(set, v, t).ops);
        }
      }
    }
  });

  it('döngü boyunca (dikiş dahil) hiçbir şey tek karede belirmez, kaybolmaz ya da yer değiştirmez', { timeout: 120_000 }, () => {
    for (const P of PERIODS) {
      for (const kind of KINDS) {
        const v = view(kind, P);
        const r = findJumps((t) => draw(set, v, t, false), P, Math.max(v.w, v.h));
        expect(r.jumps, `${set} ${kind} P=${P}`).toEqual([]);
        // 1/300 sn'de en büyük değişim de sınırlı (ölçülen en büyük: karadelik kartında ~0.45, izlerin toplamı)
        expect(r.worst, `${set} ${kind} P=${P}`).toBeLessThan(0.9);
        // katmanı olan parçalarda gerçekten bir şey çizilmiş olmalı (boş çizim her denetimi geçer)
        if (set === 'karadelik' || kind !== 'plate') expect(r.drawn, `${set} ${kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('karadelik: döngüde yıldızlar eşit aralıklarla düşer', () => {
  it('döngünün her anında kartta hemen hemen aynı sayıda yıldız görünür: kalabalık ya da boş an yok', () => {
    for (const P of PERIODS) {
      const v = view('card', P);
      const counts: number[] = [];
      // her görünen yıldız 22 dörtgenlik bir iz çizer
      for (let i = 0; i < 120; i++) counts.push(draw('karadelik', v, (i / 120) * P).ops.filter((op) => op.startsWith('fill(')).length / 22);
      expect(Math.min(...counts)).toBeGreaterThan(20);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(4);
    }
  });
});

describe('canlı 2B katman (döngü verilmeden) döngü biçimine girmez', () => {
  it('canlıda süreler döngüye uymaz (t ile t + 6 farklıdır)', () => {
    expect(draw('karadelik', view('card', undefined), 1.2 + 6).ops).not.toEqual(draw('karadelik', view('card', undefined), 1.2).ops);
    expect(draw('kuzey', view('deco', undefined), 1.2 + 6).ops).not.toEqual(draw('kuzey', view('deco', undefined), 1.2).ops);
  });
});