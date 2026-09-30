// Hareketli kozmetik setlerinin Canvas 2D katmanları: gölgelendiricinin üstüne çizilen ayrıntılar
// (içeri çekilen yıldızlar, açan çiçekler, ateşböcekleri, buz dendritleri, damlalar) ve WebGL
// kullanılamazken sade 2B zeminler. Onaylanan vitrinden (kozmetik-vitrini.html) aktarıldı.

import type { CosmeticSet } from '@diskort/shared';
import { BUZ_LOOP, buzLoopG, COSMETIC_SET_INFO, loopRate, type ShaderViewKind } from '@diskort/client-core';

/** Profil kartının ölçüleri (css px): afiş yüksekliği, avatar merkezi ve dış yarıçapı */
export interface CardGeo {
  bh: number;
  ax: number;
  ay: number;
  ar: number;
}

/** Bir çizim yüzeyi (katmanların gördüğü kadarı) */
export interface LayerView {
  kind: ShaderViewKind;
  /** Boyut (css px) */
  w: number;
  h: number;
  dpr: number;
  /** Boyuta bağlı hazır listeler (parçacıklar, dendritler) */
  cache: Map<string, unknown>;
  geo: CardGeo;
  /** Dekorasyonda avatarın yarıçapı (css px) */
  R: number;
  /**
   * Döngü biçimi (yalnızca dosyaya çizim aracı verir, bkz. client-core cosmeticShaders/loop.ts): zamana bağlı
   * her terim bu kadar saniyede kendini yineler. Verilmezse canlı çizim (uygulamada hep böyle).
   */
  loop?: number;
}

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const posmod = (a: number, n: number): number => ((a % n) + n) % n;

/** Sabit tohumlu rastgele sayı üreteci (mulberry32): her açılışta aynı görünüm */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (n: number): number => rng((n * 2654435761) >>> 0)();

/** Kristal Buz döngüsü (gölgelendiricideki iceG ile aynı): 0→1 büyür, durur, erir */
export function iceG(t: number): number {
  const s = posmod(t, 14) / 14;
  if (s < 0.45) return 1 - Math.pow(1 - s / 0.45, 3);
  if (s < 0.84) return 1;
  const k = clamp((s - 0.84) / 0.14);
  return 1 - k * k * (3 - 2 * k);
}

// ---------- Parıltı resimleri (bir kez çizilir) ----------

const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(key: string, stops: [number, string][]): HTMLCanvasElement {
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, color] of stops) gr.addColorStop(at, color);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}
const SPR = {
  ff: () => glowSprite('ff', [[0, 'rgba(255,255,230,1)'], [0.1, 'rgba(245,255,160,.95)'], [0.3, 'rgba(200,245,100,.32)'], [0.6, 'rgba(150,220,70,.08)'], [1, 'rgba(120,200,60,0)']]),
  ffb: () => glowSprite('ffb', [[0, 'rgba(230,255,150,.35)'], [0.7, 'rgba(210,250,120,.22)'], [0.85, 'rgba(210,250,120,.1)'], [1, 'rgba(200,240,100,0)']]),
  warm: () => glowSprite('warm', [[0, 'rgba(255,250,235,1)'], [0.15, 'rgba(255,200,120,.8)'], [0.45, 'rgba(255,120,40,.18)'], [1, 'rgba(255,90,20,0)']]),
  cool: () => glowSprite('cool', [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(200,240,255,.7)'], [0.5, 'rgba(120,200,255,.12)'], [1, 'rgba(100,180,255,0)']]),
  mag: () => glowSprite('mag', [[0, 'rgba(255,240,255,1)'], [0.2, 'rgba(255,80,220,.6)'], [0.55, 'rgba(255,40,200,.12)'], [1, 'rgba(255,0,200,0)']]),
  cyan: () => glowSprite('cyan', [[0, 'rgba(240,255,255,1)'], [0.2, 'rgba(60,230,255,.6)'], [0.55, 'rgba(20,200,255,.12)'], [1, 'rgba(0,180,255,0)']]),
};

function sprite(ctx: Ctx, spr: HTMLCanvasElement, x: number, y: number, size: number, alpha: number): void {
  if (alpha <= 0.003) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(spr, x - size / 2, y - size / 2, size, size);
}

/** Dört köşeli pırıltı yıldızı */
function sparkle(ctx: Ctx, x: number, y: number, L: number, alpha: number, col: string, rot = 0): void {
  if (alpha <= 0.003) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = col;
  const w = L * 0.13;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (a: number, b: number): Pt => [x + a * c - b * s, y + a * s + b * c];
  ctx.beginPath();
  let p = P(-L, 0);
  ctx.moveTo(p[0], p[1]);
  p = P(0, -w);
  ctx.lineTo(p[0], p[1]);
  p = P(L, 0);
  ctx.lineTo(p[0], p[1]);
  p = P(0, w);
  ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  p = P(0, -L * 0.8);
  ctx.moveTo(p[0], p[1]);
  p = P(w, 0);
  ctx.lineTo(p[0], p[1]);
  p = P(0, L * 0.8);
  ctx.lineTo(p[0], p[1]);
  p = P(-w, 0);
  ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}

function cached<T>(v: LayerView, key: string, make: () => T): T {
  const k = `${key}|${Math.round(v.w)}x${Math.round(v.h)}`;
  let value = v.cache.get(k) as T | undefined;
  if (value === undefined) {
    value = make();
    v.cache.set(k, value);
  }
  return value;
}

// ---------- 1. Karadelik: içeri çekilen, çekimle uzayan yıldızlar ----------

/** Deliğin yeri ve yarıçapı (gölgelendiricideki effect() ile aynı) */
function bhLayout(v: LayerView): { cx: number; cy: number; RS: number } {
  if (v.kind === 'card') return { cx: v.w * 0.73, cy: v.geo.bh * 0.48, RS: v.geo.bh * 0.15 };
  if (v.kind === 'plate') return { cx: v.w - v.h * 1.35, cy: v.h * 0.5, RS: v.h * 0.24 };
  if (v.kind === 'deco') return { cx: v.w / 2, cy: v.h / 2, RS: v.R };
  return { cx: v.w / 2, cy: v.h / 2, RS: Math.min(v.w, v.h) * 0.14 };
}

interface Infall {
  D: number;
  off: number;
  r0: number;
  th: number;
  sp: number;
  w: number;
}

function drawKaradelik(ctx: Ctx, v: LayerView, t: number): void {
  const { cx, cy, RS } = bhLayout(v);
  ctx.globalCompositeOperation = 'lighter';
  const c = Math.cos(-0.12);
  const s = Math.sin(-0.12);
  if (v.kind === 'deco') {
    const spots = cached(v, 'bhs', () => {
      const r = rng(5);
      return Array.from({ length: 5 }, () => ({ a: r() * TAU, rr: 1.15 + r() * 0.22, sz: 7 + r() * 7 }));
    });
    for (const o of spots) {
      const rr = RS * o.rr;
      const a = o.a - t * 1.4 * Math.pow(1.1 / o.rr, 1.5);
      const X = Math.cos(a) * rr;
      const Y = Math.sin(a) * rr * 0.3;
      const x = cx + c * X + s * Y;
      const y = cy - s * X + c * Y;
      const front = Math.sin(a) > 0;
      if (!front && Math.hypot(x - cx, y - cy) < RS) continue;
      const dop = Math.pow(Math.max(0.1, 1 - 0.6 * Math.cos(a)), 1.6);
      sprite(ctx, SPR.warm(), x, y, o.sz * (0.8 + 0.3 * dop), 0.55 * dop);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }
  const n = v.kind === 'card' ? 30 : v.kind === 'plate' ? 9 : 16;
  const rMax = v.kind === 'card' ? Math.max(v.w, v.h) * 0.95 : v.kind === 'plate' ? v.w * 0.4 : Math.max(v.w, v.h) * 0.65;
  const list = cached<Infall[]>(v, 'bhi', () => {
    const r = rng(17);
    return Array.from({ length: n }, () => ({
      D: 4.5 + r() * 5,
      off: r() * 20,
      r0: RS * 2.4 + r() * (rMax - RS * 2.4),
      th: r() * TAU,
      sp: 0.8 + r() * 0.6,
      w: 0.7 + r() * 1.1,
    }));
  });
  const bh = v.kind === 'card' ? v.geo.bh : 1e9;
  ctx.lineCap = 'round';
  for (const o of list) {
    const u = posmod(t + o.off, o.D) / o.D;
    const at = (uu: number): [number, number, number, number] => {
      uu = clamp(uu);
      const r = RS * 1.02 + (o.r0 - RS * 1.02) * (1 - uu * uu);
      const th = o.th + o.sp * (Math.sqrt(o.r0 / r) - 1) * 1.6;
      const X = Math.cos(th) * r;
      const Y = Math.sin(th) * r * 0.45;
      return [cx + c * X + s * Y, cy - s * X + c * Y, r, th];
    };
    const h = at(u);
    const r = h[2];
    if (Math.sin(h[3]) < 0 && Math.hypot(h[0] - cx, h[1] - cy) < RS * 1.05) continue;
    let al = smooth(0, 0.1, u) * smooth(RS * 1.05, RS * 1.7, r);
    // kartın gövdesinde (yazıların üstünde) iyice sönük
    if (h[1] > bh) al *= 0.3;
    if (al < 0.01) continue;
    const heat = smooth(RS * 4, RS * 1.3, r);
    const col = heat > 0.5 ? 'rgb(255,196,130)' : 'rgb(205,225,255)';
    // iz: yörünge boyunca geriye doğru
    const steps = 7;
    const du = 0.006 + 0.02 * heat;
    let px = h[0];
    let py = h[1];
    for (let k = 1; k <= steps; k++) {
      const q = at(u - k * du);
      ctx.globalAlpha = al * (1 - k / (steps + 1)) * 0.7;
      ctx.strokeStyle = col;
      ctx.lineWidth = o.w * (1 - k / (steps + 1)) * (1 + heat);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      px = q[0];
      py = q[1];
    }
    // gelgit uzaması: merkeze doğru (radyal) çekilir
    const st = Math.min(RS * 1.3, (RS * RS * 2.2) / r) * heat;
    if (st > 0.5) {
      const dx = (h[0] - cx) / r;
      const dy = (h[1] - cy) / r;
      ctx.globalAlpha = al * 0.8;
      ctx.strokeStyle = col;
      ctx.lineWidth = o.w * 0.9;
      ctx.beginPath();
      ctx.moveTo(h[0] - dx * st, h[1] - dy * st);
      ctx.lineTo(h[0] + dx * st * 0.6, h[1] + dy * st * 0.6);
      ctx.stroke();
    }
    sprite(ctx, heat > 0.5 ? SPR.warm() : SPR.cool(), h[0], h[1], 7 + 6 * o.w + 8 * heat, al);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- 2. Sakura: dal, açan çiçekler, rüzgârda takla atan yapraklar, asma çelengi ----------

const PETAL = new Path2D('M0 -0.5 C0.36 -0.36 0.44 0.1 0.21 0.5 L0 0.36 L-0.21 0.5 C-0.44 0.1 -0.36 -0.36 0 -0.5Z');
const FPETAL = new Path2D('M0 0 C0.36 0.14 0.44 0.6 0.21 1 L0 0.86 L-0.21 1 C-0.44 0.6 -0.36 0.14 0 0Z');
const LEAF = new Path2D('M0 0 Q0.45 0.42 0 1 Q-0.45 0.42 0 0Z');

interface Fills {
  a: CanvasGradient;
  b: CanvasGradient;
  fl: CanvasGradient;
  lf: CanvasGradient;
}
const fillCache = new WeakMap<Ctx, Fills>();
function fills(ctx: Ctx): Fills {
  let f = fillCache.get(ctx);
  if (f) return f;
  const a = ctx.createLinearGradient(0, -0.5, 0, 0.5);
  a.addColorStop(0, '#fff3f7');
  a.addColorStop(0.55, '#ffc4d7');
  a.addColorStop(1, '#f48ab0');
  const b = ctx.createLinearGradient(0, -0.5, 0, 0.5);
  b.addColorStop(0, '#fbe6ee');
  b.addColorStop(1, '#e8a9c1');
  const fl = ctx.createLinearGradient(0, 0, 0, 1);
  fl.addColorStop(0, '#fff8fb');
  fl.addColorStop(0.45, '#ffd2e0');
  fl.addColorStop(1, '#f28bb2');
  const lf = ctx.createLinearGradient(0, 0, 0, 1);
  lf.addColorStop(0, '#3f7a34');
  lf.addColorStop(1, '#a6d672');
  f = { a, b, fl, lf };
  fillCache.set(ctx, f);
  return f;
}

/** Üç boyutlu dönen yaprak: yerel eksenler döndürülüp 2B afin dönüşüme indirgenir (kısalma kendiliğinden oluşur) */
function petal3D(ctx: Ctx, dpr: number, F: Fills, x: number, y: number, size: number, ax: number, ay: number, az: number, alpha: number): void {
  const ca = Math.cos(ax);
  const sa = Math.sin(ax);
  const cb = Math.cos(ay);
  const sb = Math.sin(ay);
  const cc = Math.cos(az);
  const sc = Math.sin(az);
  const Ux = cc * cb;
  const Uy = sc * cb;
  const e2x = sb * sa;
  const e2y = ca;
  const Vx = cc * e2x - sc * e2y;
  const Vy = sc * e2x + cc * e2y;
  const e3x = sb * ca;
  const e3y = -sa;
  const Nx = cc * e3x - sc * e3y;
  const Ny = sc * e3x + cc * e3y;
  const Nz = cb * ca;
  const s = size * dpr;
  ctx.setTransform(Ux * s, Uy * s, Vx * s, Vy * s, x * dpr, y * dpr);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = Nz >= 0 ? F.a : F.b;
  ctx.fill(PETAL);
  const lam = Math.abs(-0.35 * Nx - 0.55 * Ny + 0.76 * Nz);
  const dark = (1 - lam) * 0.55;
  if (dark > 0.03) {
    ctx.globalAlpha = alpha * dark;
    ctx.fillStyle = '#5a1636';
    ctx.fill(PETAL);
  }
  if (lam > 0.86) {
    ctx.globalAlpha = alpha * (lam - 0.86) * 2.6;
    ctx.fillStyle = '#ffffff';
    ctx.fill(PETAL);
  }
}

function flower(ctx: Ctx, dpr: number, F: Fills, x: number, y: number, size: number, open: number, rot: number, alpha: number): void {
  if (alpha <= 0.01 || open <= 0.01) return;
  const k = 0.3 + 0.7 * open;
  const tilt = 0.84;
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * TAU) / 5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sx = size * k * (0.65 + 0.35 * open);
    const sy = size * k;
    ctx.setTransform(dpr * c * sx, dpr * s * sx * tilt, -dpr * s * sy, dpr * c * sy * tilt, dpr * x, dpr * y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = F.fl;
    ctx.fill(FPETAL);
    if (i % 2) {
      ctx.globalAlpha = alpha * 0.14;
      ctx.fillStyle = '#7a1f48';
      ctx.fill(FPETAL);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#d9467a';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.17 * k, 0, TAU);
  ctx.fill();
  const st = smooth(0.45, 1, open);
  if (st > 0) {
    ctx.strokeStyle = '#f7a3c0';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = rot * 1.3 + (i * TAU) / 7;
      const L = size * 0.45 * st;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L * tilt);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffd36b';
    for (let i = 0; i < 7; i++) {
      const a = rot * 1.3 + (i * TAU) / 7;
      const L = size * 0.45 * st;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * L, y + Math.sin(a) * L * tilt, 0.95, 0, TAU);
      ctx.fill();
    }
  }
}

function bud(ctx: Ctx, x: number, y: number, size: number, alpha: number): void {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#e46f98';
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.22, size * 0.3, 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#6e3a2c';
  ctx.beginPath();
  ctx.ellipse(x - size * 0.08, y + size * 0.2, size * 0.12, size * 0.08, 0.4, 0, TAU);
  ctx.fill();
}

const BRANCH = {
  main: [[8, -6], [-30, 10], [-70, 18], [-128, 44]] as Pt[],
  tw1: [[-50, 16], [-64, 6], [-86, 0]] as Pt[],
  tw2: [[-92, 30], [-104, 46], [-116, 62]] as Pt[],
  bl: [[-18, 3, 1.05], [-44, 16, 0.85], [-84, 1, 0.95], [-102, 36, 1.1], [-127, 44, 0.85], [-115, 61, 0.8], [-68, 22, 0.72]],
};

interface Petal {
  x0: number;
  y0: number;
  z: number;
  fall: number;
  ff: number;
  famp: number;
  ph: number;
  wx: number;
  wy: number;
  wz: number;
  a0: number;
  b0: number;
  c0: number;
  sc: number;
}

function petalSet(v: LayerView, n: number, scale: number): Petal[] {
  return cached(v, `pet${n}`, () => {
    const r = rng(29);
    return Array.from({ length: n }, () => ({
      x0: r(),
      y0: r(),
      z: r(),
      fall: 14 + r() * 16,
      ff: 0.6 + r() * 1.2,
      famp: 6 + r() * 14,
      ph: r() * TAU,
      wx: (r() - 0.5) * 3.4,
      wy: (r() - 0.5) * 2.8,
      wz: (r() - 0.5) * 1.6,
      a0: r() * TAU,
      b0: r() * TAU,
      c0: r() * TAU,
      sc: scale,
    })).sort((a, b) => a.z - b.z);
  });
}

function drawPetals(ctx: Ctx, v: LayerView, t: number, list: Petal[], dimBody: boolean): void {
  const F = fills(ctx);
  const W = v.w;
  const H = v.h;
  const M = 24;
  for (const o of list) {
    const par = 0.45 + 0.9 * o.z;
    let X = o.x0 * W - par * (18 * t - 113 * Math.cos(0.23 * t)) + o.famp * Math.sin(t * o.ff + o.ph);
    let Y = o.y0 * H + o.fall * par * t + 6 * Math.sin(t * o.ff * 0.7 + o.ph);
    X = posmod(X + M, W + 2 * M) - M;
    Y = posmod(Y + M, H + 2 * M) - M;
    const size = (5 + 6 * o.z) * o.sc;
    let al = 0.4 + 0.55 * o.z;
    if (dimBody && Y > v.geo.bh) al *= 0.75;
    // plakada yapraklar yazıların altına süzülmez: sola doğru kaybolur
    if (v.kind === 'plate') al *= smooth(W * 0.38, W * 0.75, X);
    if (al < 0.01) continue;
    petal3D(
      ctx,
      v.dpr,
      F,
      X,
      Y,
      size,
      o.a0 + o.wx * t + 0.9 * Math.sin(t * 0.23 + o.ph),
      o.b0 + o.wy * t,
      o.c0 + o.wz * t * 0.5 + 0.4 * Math.sin(t * o.ff + o.ph),
      al,
    );
  }
}

function drawBranch(ctx: Ctx, v: LayerView, t: number, ax: number, ay: number, sc: number): void {
  const dpr = v.dpr;
  const F = fills(ctx);
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ax, dpr * ay);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 1;
  const stroke = (pts: Pt[], w: number, col: string): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    if (pts.length === 4) ctx.bezierCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1], pts[3]![0], pts[3]![1]);
    else ctx.quadraticCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    ctx.stroke();
  };
  stroke(BRANCH.main, 5, '#24121b');
  stroke(BRANCH.tw1, 2.8, '#24121b');
  stroke(BRANCH.tw2, 2.4, '#24121b');
  ctx.globalAlpha = 0.55;
  stroke(
    BRANCH.main.map((p) => [p[0], p[1] - 1.2] as Pt),
    1.4,
    '#6b3a4c',
  );
  ctx.globalAlpha = 1;
  const P = 11;
  BRANCH.bl.forEach((b, j) => {
    const off = j * 1.63 + 0.4;
    const bx = ax + b[0]! * sc;
    const by = ay + b[1]! * sc;
    const size = 11 * b[2]! * sc;
    const s = posmod(t + off, P) / P;
    const open = s < 0.06 ? 0 : easeOutBack(clamp((s - 0.06) / 0.24));
    const pa = 1 - smooth(0.76, 0.8, s);
    const budA = s < 0.1 || s > 0.8 ? 1 : 1 - smooth(0.06, 0.14, s);
    bud(ctx, bx, by, size, budA);
    flower(ctx, dpr, F, bx, by, size, open * (s > 0.8 ? 0 : 1), j * 1.3 + 0.08 * Math.sin(t * 0.8 + j), pa);
    // kopan yapraklar
    const cyc = Math.floor((t + off) / P);
    for (let cc = cyc; cc >= cyc - 1; cc--) {
      const age = t - (cc * P - off + 0.78 * P);
      if (age < 0 || age > 9) continue;
      for (let k = 0; k < 5; k++) {
        const hk = hash(j * 97 + k * 13 + (cc & 1023) * 7);
        const a = j * 1.3 + (k * TAU) / 5;
        const X = bx + Math.cos(a) * size * 0.6 - (20 + 14 * hk) * age - 9 * Math.sin(age * 1.1 + k);
        const Y = by + Math.sin(a) * size * 0.5 + (14 + 10 * hk) * age + 5 * Math.sin(age * 1.7 + k);
        if (X < -20 || Y > v.h + 20) continue;
        petal3D(ctx, dpr, F, X, Y, size * 0.62, a + age * (1.5 + hk * 2), age * (2 + hk), a + age * 0.6, 0.92 * (1 - smooth(7, 9, age)));
      }
    }
  });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWreath(ctx: Ctx, v: LayerView, t: number): void {
  const dpr = v.dpr;
  const F = fills(ctx);
  const cx = v.w / 2;
  const cy = v.h / 2;
  const R = v.R;
  const P = 16;
  const s = posmod(t, P) / P;
  const G = s < 0.4 ? easeInOut(s / 0.4) : 1;
  const fadeA = 1 - smooth(0.9, 0.985, s);
  const petalA = 1 - smooth(0.8, 0.84, s);
  const vines = [
    { a0: 1.72, a1: 1.72 + 3.75, ph: 0, fl: [0.2, 0.45, 0.7, 0.95] },
    { a0: 1.42, a1: 1.42 - 3.05, ph: 2, fl: [0.3, 0.62, 0.92] },
  ];
  const flowersAt: { x: number; y: number; g: number; size: number; rot: number; key: number }[] = [];
  ctx.lineCap = 'round';
  // asmanın boyutu avatara göre (vitrin 46 piksellik yarıçapa göre çizilmişti)
  const k = R / 46;
  for (const vn of vines) {
    const N = 60;
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const th = mix(vn.a0, vn.a1, u);
      const rr = R * 1.08 + 2.4 * k * Math.sin(u * TAU * 3 + vn.ph);
      pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, u, th]);
    }
    for (let i = 1; i <= N; i++) {
      const u = pts[i]![2];
      if (pts[i - 1]![2] > G) break;
      const tip = clamp((G - pts[i - 1]![2]) * 14);
      ctx.globalAlpha = fadeA;
      ctx.strokeStyle = '#3b5b2a';
      ctx.lineWidth = (3 - u * 1.4) * (0.3 + 0.7 * tip) * k;
      const e = Math.min(1, (G - pts[i - 1]![2]) / (u - pts[i - 1]![2]));
      ctx.beginPath();
      ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
      ctx.lineTo(mix(pts[i - 1]![0], pts[i]![0], e), mix(pts[i - 1]![1], pts[i]![1], e));
      ctx.stroke();
    }
    for (let i = 3; i < N; i += 5) {
      const u = pts[i]![2];
      const g = clamp((G - u) * 9);
      if (g <= 0) continue;
      const tang = Math.atan2(pts[i + 1]![1] - pts[i - 1]![1], pts[i + 1]![0] - pts[i - 1]![0]);
      const side = (i / 5) % 2 < 1 ? 1 : -1;
      const a = tang + side * 1.0 + 0.06 * Math.sin(t * 1.3 + i);
      const sz = 7.5 * k * easeOutBack(g) * (1 - u * 0.25);
      const c = Math.cos(a - Math.PI / 2);
      const sn = Math.sin(a - Math.PI / 2);
      ctx.setTransform(dpr * c * sz * 0.9, dpr * sn * sz * 0.9, -dpr * sn * sz, dpr * c * sz, dpr * pts[i]![0], dpr * pts[i]![1]);
      ctx.globalAlpha = fadeA;
      ctx.fillStyle = F.lf;
      ctx.fill(LEAF);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    vn.fl.forEach((u, j) => {
      const i = Math.round(u * N);
      const p = pts[Math.min(N, i)]!;
      flowersAt.push({
        x: p[0] + Math.cos(p[3]) * 3 * k,
        y: p[1] + Math.sin(p[3]) * 3 * k,
        g: clamp((G - u - 0.03) * 5),
        size: (j === vn.fl.length - 1 ? 12 : 9 + (j % 2) * 1.5) * k,
        rot: u * 9 + j,
        key: j + vn.ph * 10,
      });
    });
  }
  for (const f of flowersAt) {
    const open = f.g > 0 ? easeOutBack(f.g) : 0;
    bud(ctx, f.x, f.y, f.size * 0.8, fadeA * (1 - smooth(0.1, 0.4, f.g)));
    flower(ctx, dpr, F, f.x, f.y, f.size, open, f.rot + 0.07 * Math.sin(t * 1.1 + f.key), fadeA * petalA);
    if (G >= 1 && petalA > 0.5) {
      const tw = Math.pow(Math.max(0, Math.sin(t * 1.7 + f.key * 2.1)), 12);
      ctx.globalCompositeOperation = 'lighter';
      sparkle(ctx, f.x + f.size * 0.9, f.y - f.size * 0.7, 4.5 * k, tw * 0.9, '#fff', 0.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (s > 0.8) {
      const age = (s - 0.8) * P;
      for (let j = 0; j < 5; j++) {
        const a = f.rot + (j * TAU) / 5;
        const hk = hash((j * 31 + f.key * 7) | 0);
        const X = f.x + Math.cos(a) * f.size * 0.5 + (hk - 0.5) * 16 * k * age + 5 * k * Math.sin(age * 2 + j);
        const Y = f.y + Math.sin(a) * f.size * 0.4 + (10 + 14 * hk) * k * age + 4 * k * age * age;
        petal3D(ctx, dpr, F, X, Y, f.size * 0.55, a + age * 3, age * (2 + hk * 2), a, 0.9 * (1 - smooth(1.6, 2.4, age)));
      }
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
}

function drawSakura(ctx: Ctx, v: LayerView, t: number): void {
  if (v.kind === 'deco') drawWreath(ctx, v, t);
  else if (v.kind === 'card') {
    drawPetals(ctx, v, t, petalSet(v, 22, 1), true);
    drawBranch(ctx, v, t, v.w, 0, v.geo.bh / 118);
  } else if (v.kind === 'thumb') {
    drawBranch(ctx, v, t, v.w, 0, v.h / 150);
    drawPetals(ctx, v, t, petalSet(v, 14, 0.8), false);
  } else {
    drawPetals(ctx, v, t, petalSet(v, 7, 0.6), false);
    drawBranch(ctx, v, t, v.w + 2, -2, 0.36);
  }
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.globalAlpha = 1;
}

// ---------- 3. Kuzey Işıkları: kayan yıldız, halkada pırıltı ----------

function shootingStar(ctx: Ctx, t: number, W: number, yMax: number, seed: number): void {
  const P = 6.5;
  const cyc = Math.floor((t + seed) / P);
  const u = posmod(t + seed, P) / P;
  if (u > 0.14) return;
  const r = rng(cyc * 7919 + seed * 131);
  const x0 = W * (0.35 + 0.6 * r());
  const y0 = yMax * 0.35 * r();
  const ang = Math.PI * (0.8 + 0.08 * r());
  const k = u / 0.14;
  const Ld = Math.min(W, yMax * 2) * 0.7;
  const hx = x0 + Math.cos(ang) * Ld * k;
  const hy = y0 + Math.sin(ang) * Ld * k;
  const tl = 46 * (1 - k * 0.3);
  const a = Math.sin(k * Math.PI);
  const g = ctx.createLinearGradient(hx, hy, hx - Math.cos(ang) * tl, hy - Math.sin(ang) * tl);
  g.addColorStop(0, 'rgba(230,255,245,1)');
  g.addColorStop(1, 'rgba(120,255,200,0)');
  ctx.globalAlpha = a;
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - Math.cos(ang) * tl, hy - Math.sin(ang) * tl);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  sprite(ctx, SPR.cool(), hx, hy, 10, a);
  ctx.globalCompositeOperation = 'source-over';
}

function drawAurora(ctx: Ctx, v: LayerView, t: number): void {
  if (v.kind === 'deco') {
    const list = cached(v, 'ast', () => {
      const r = rng(3);
      return Array.from({ length: 7 }, () => ({ a: r() * TAU, rr: 1.15 + r() * 0.3, ph: r() * TAU, sp: 1 + r() * 1.5, L: 3 + r() * 3 }));
    });
    const k = v.R / 46;
    ctx.globalCompositeOperation = 'lighter';
    for (const o of list) {
      const tw = Math.pow(Math.max(0, Math.sin(t * o.sp + o.ph)), 6);
      const x = v.w / 2 + Math.cos(o.a + t * 0.05) * v.R * o.rr;
      const y = v.h / 2 + Math.sin(o.a + t * 0.05) * v.R * o.rr;
      sparkle(ctx, x, y, o.L * k, tw, '#eafff6', 0);
      sprite(ctx, SPR.cool(), x, y, o.L * 3 * k, tw * 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }
  if (v.kind === 'card') shootingStar(ctx, t, v.w, v.geo.bh, 1.3);
  else if (v.kind === 'thumb') shootingStar(ctx, t, v.w, v.h * 0.6, 3.1);
  ctx.globalAlpha = 1;
}

// ---------- 4. Ateşböceği Ormanı ----------

interface Firefly {
  x: number;
  y: number;
  z: number;
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  ph: number;
  rate: number;
  bph: number;
  dx: number;
  rr: number;
  inc: number;
  rho: number;
  sp: number;
}

function ffList(v: LayerView, n: number): Firefly[] {
  return cached(v, `ff${n}`, () => {
    const r = rng(41);
    return Array.from({ length: n }, () => ({
      x: r(),
      y: r(),
      z: r(),
      ax: 10 + 30 * r(),
      ay: 8 + 18 * r(),
      fx: 0.12 + 0.25 * r(),
      fy: 0.1 + 0.22 * r(),
      ph: r() * TAU,
      rate: 0.7 + 1.3 * r(),
      bph: r() * TAU,
      dx: (r() - 0.5) * 5,
      rr: 1.1 + 0.28 * r(),
      inc: 0.25 + 0.6 * r(),
      rho: (r() - 0.5) * 1.2,
      sp: (0.35 + 0.4 * r()) * (r() < 0.5 ? -1 : 1),
    })).sort((a, b) => a.z - b.z);
  });
}
const blinkOf = (o: Firefly, t: number): number => Math.pow(Math.max(0, Math.sin(t * o.rate + o.bph)), 4) * 0.85 + 0.15;

function drawForest(ctx: Ctx, v: LayerView, t: number): void {
  ctx.globalCompositeOperation = 'lighter';
  const core = SPR.ff();
  const soft = SPR.ffb();
  if (v.kind === 'deco') {
    const cx = v.w / 2;
    const cy = v.h / 2;
    const R = v.R;
    const k = R / 46;
    for (const o of ffList(v, 9)) {
      const a = o.ph + t * o.sp;
      const ro = R * o.rr;
      const X = Math.cos(a) * ro;
      const Y = Math.sin(a) * ro * Math.cos(o.inc) * 0.6 + 4 * k * Math.sin(t * o.fy * 3 + o.ph);
      const Z = Math.sin(a) * Math.sin(o.inc);
      const c = Math.cos(o.rho);
      const s = Math.sin(o.rho);
      const x = cx + c * X - s * Y;
      const y = cy + s * X + c * Y;
      if (Z < 0 && Math.hypot(x - cx, y - cy) < R + 1) continue;
      const b = blinkOf(o, t);
      sprite(ctx, core, x, y, (9 + 7 * (Z + 1)) * k * (0.7 + 0.3 * b), b * (0.55 + (0.35 * (Z + 1)) / 2));
    }
  } else {
    // kartta daha çok ateşböceği (vitrinde seyrek kalıyordu)
    const n = v.kind === 'card' ? 34 : v.kind === 'plate' ? 8 : 14;
    const W = v.w;
    const H = v.h;
    const y0 = v.kind === 'plate' ? 4 : H * 0.1;
    const y1 = v.kind === 'plate' ? H - 4 : H * 0.95;
    for (const o of ffList(v, n)) {
      let x = o.x * W + o.ax * Math.sin(t * o.fx + o.ph) + o.ax * 0.4 * Math.sin(t * o.fx * 2.7 + o.ph * 1.7) + o.dx * t;
      x = posmod(x + 20, W + 40) - 20;
      const y =
        y0 +
        o.y * (y1 - y0) +
        (v.kind === 'plate' ? 0.3 : 1) * (o.ay * Math.sin(t * o.fy + o.ph * 2.1) + o.ay * 0.3 * Math.cos(t * o.fy * 3.1 + o.ph));
      const b = blinkOf(o, t);
      let dim = 1;
      if (v.kind === 'card' && y > v.geo.bh) dim = 0.7;
      // plakada yalnızca sağda: yazıların altında parlayan nokta olmasın
      if (v.kind === 'plate') dim = smooth(W * 0.4, W * 0.8, x);
      const sz = (v.kind === 'plate' ? 0.6 : 1) * (8 + 22 * o.z * o.z) * (0.6 + 0.4 * b);
      if (o.z > 0.85 && v.kind !== 'plate') sprite(ctx, soft, x, y, sz * 2.2, b * 0.5 * dim);
      sprite(ctx, core, x, y, sz, b * (0.35 + 0.65 * o.z) * dim);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- 5. Kristal Buz: dallanarak büyüyen buz kristalleri ve pırıltılar ----------

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  b0: number;
  b1: number;
  d: number;
  /** Hangi kökten büyüdü (yalnızca döngü biçimi kullanır) */
  r: number;
}
interface Dendrites {
  segs: Seg[];
  maxB: number;
  gl: { sg: Seg; ph: number; rate: number; L: number }[];
  /** Kök başına: yeri, ilk ve son doğum anı (yalnızca döngü biçimi kullanır) */
  spans: { x: number; y: number; b0: number; b1: number }[];
}
interface Root {
  x: number;
  y: number;
  a: number;
  len: number;
  delay?: number;
}

function buildDendrites(roots: Root[], seed: number, maxDepth: number): Dendrites {
  const r = rng(seed);
  const segs: Seg[] = [];
  let maxB = 0;
  const spans: Dendrites['spans'] = [];
  const arm = (x: number, y: number, ang: number, len: number, depth: number, birth: number): void => {
    const steps = depth === 0 ? 6 : depth === 1 ? 4 : 2;
    const sl = len / steps;
    let px = x;
    let py = y;
    let b = birth;
    for (let i = 0; i < steps; i++) {
      const a = ang + (r() - 0.5) * 0.12;
      const nx = px + Math.cos(a) * sl;
      const ny = py + Math.sin(a) * sl;
      const span = spans[spans.length - 1]!;
      segs.push({ x1: px, y1: py, x2: nx, y2: ny, b0: b, b1: b + sl, d: depth, r: spans.length - 1 });
      b += sl;
      maxB = Math.max(maxB, b);
      span.b1 = Math.max(span.b1, b);
      if (depth < maxDepth) {
        const side = len * (depth === 0 ? 0.42 : 0.36) * (1 - (i / steps) * 0.6) * (0.7 + 0.5 * r());
        if (r() < 0.8) arm(nx, ny, a + Math.PI / 3, side, depth + 1, b);
        if (r() < 0.8) arm(nx, ny, a - Math.PI / 3, side, depth + 1, b);
      }
      px = nx;
      py = ny;
    }
  };
  for (const o of roots) {
    spans.push({ x: o.x, y: o.y, b0: o.delay ?? 0, b1: o.delay ?? 0 });
    arm(o.x, o.y, o.a, o.len, 0, o.delay ?? 0);
  }
  const gl: Dendrites['gl'] = [];
  const rr = rng(seed + 9);
  for (let i = 0; i < 16 && segs.length; i++) {
    const sg = segs[Math.floor(rr() * segs.length)]!;
    gl.push({ sg, ph: rr() * TAU, rate: 1.2 + rr() * 1.8, L: 4 + rr() * 6 });
  }
  return { segs, maxB, gl, spans };
}

function iceRoots(v: LayerView): Root[] {
  const W = v.w;
  const H = v.h;
  const out: Root[] = [];
  if (v.kind === 'deco') {
    const cx = W / 2;
    const cy = H / 2;
    const R = v.R;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.2;
      out.push({ x: cx + Math.cos(a) * R * 1.02, y: cy + Math.sin(a) * R * 1.02, a: a + (i % 2 ? 0.25 : -0.25), len: (W / 2 - R) * 1.05, delay: (i % 3) * 3 });
    }
  } else if (v.kind === 'plate') {
    out.push(
      { x: W, y: 0, a: 2.4, len: H * 1.2 },
      { x: W, y: H, a: -2.4, len: H * 1.1, delay: 4 },
      { x: W, y: H / 2, a: Math.PI, len: H * 1.4, delay: 2 },
      { x: W - H * 1.6, y: H, a: -1.9, len: H * 0.8, delay: 10 },
    );
  } else {
    const card = v.kind === 'card';
    const L = Math.min(W, H) * (card ? 0.26 : 0.34);
    out.push(
      { x: 0, y: 0, a: 0.78, len: L },
      { x: W, y: 0, a: 2.36, len: L * 1.1, delay: 6 },
      // kartta sol alt köşe kısa ve kenara yakın: yazıların ve düğmenin üstüne binmesin
      card ? { x: 0, y: H, a: -0.45, len: L * 0.42, delay: 3 } : { x: 0, y: H, a: -0.78, len: L * 0.95, delay: 3 },
      { x: W, y: H, a: -2.36, len: L * (card ? 0.7 : 1), delay: 8 },
    );
    if (card) out.push({ x: W * 0.5, y: 0, a: 1.5, len: L * 0.45, delay: 10 }, { x: W, y: v.geo.bh * 0.55, a: Math.PI - 0.15, len: L * 0.5, delay: 12 });
    else out.push({ x: W * 0.5, y: H, a: -1.57, len: L * 0.5, delay: 5 });
  }
  return out;
}

/**
 * Döngü biçimi (yalnızca dosyaya çizim aracı; bkz. client-core cosmeticShaders/buz.ts BUZ_LOOP). Canlıda bütün
 * dendritler aynı eğriyle birlikte büyür ve birlikte erir; döngüde her kök kendi evresiyle büyür, durur, erir
 * (evre, gölgelendiricideki kırağı dalgasıyla aynı: köke en yakın kırağı kalınlaşırken dendrit de uzar). Bir
 * kök erirken başkası büyür: hiçbir an boş değildir. Hiçbir şey tek karede belirmez ya da kaybolmaz: kökün
 * çizgileri, uçtaki parıltı ve pırıltılar büyümeyle birlikte yumuşakça açılır.
 */
function drawIceLoop(ctx: Ctx, v: LayerView, t: number, D: Dendrites, loop: number): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const dim = v.kind === 'card' ? 0.75 : v.kind === 'plate' ? 0.8 : 1;
  const W1 = [3.4, 2.2, 1.4];
  const W2 = [1.1, 0.8, 0.6];
  const A1 = [0.1, 0.08, 0.06];
  const A2 = [0.85, 0.65, 0.5];
  // Kök başına: büyüme (0-1), doğum ölçeğindeki karşılığı ve yumuşak açılma
  const roots = D.spans.map((s) => {
    const turn = Math.atan2(s.y - v.h / 2, s.x - v.w / 2) / TAU;
    const phase = v.kind === 'plate' ? (s.y / v.h) * BUZ_LOOP.platePhase : v.kind === 'card' ? turn * BUZ_LOOP.cardWaves : turn;
    const L = buzLoopG(t, loop, phase);
    return { G: s.b0 + L * (s.b1 - s.b0), span: s.b1 - s.b0, fade: smooth(0, 0.12, L), paths: [new Path2D(), new Path2D(), new Path2D()], tips: [] as Pt[] };
  });
  for (const sg of D.segs) {
    const R = roots[sg.r]!;
    if (sg.b0 >= R.G) continue;
    const f = Math.min(1, (R.G - sg.b0) / (sg.b1 - sg.b0));
    const x2 = sg.x1 + (sg.x2 - sg.x1) * f;
    const y2 = sg.y1 + (sg.y2 - sg.y1) * f;
    R.paths[sg.d]!.moveTo(sg.x1, sg.y1);
    R.paths[sg.d]!.lineTo(x2, y2);
    if (f < 1 && sg.d === 0) R.tips.push([x2, y2]);
  }
  for (const R of roots) {
    if (R.fade <= 0) continue;
    for (let d = 0; d < 3; d++) {
      ctx.strokeStyle = '#8fdcff';
      ctx.lineWidth = W1[d]!;
      ctx.globalAlpha = A1[d]! * dim * R.fade;
      ctx.stroke(R.paths[d]!);
      ctx.strokeStyle = '#effbff';
      ctx.lineWidth = W2[d]!;
      ctx.globalAlpha = A2[d]! * dim * R.fade;
      ctx.stroke(R.paths[d]!);
    }
    for (const p of R.tips) sprite(ctx, SPR.cool(), p[0], p[1], 9, 0.8 * dim * R.fade);
  }
  for (const g of D.gl) {
    const R = roots[g.sg.r]!;
    // pırıltı, parçası tamamlandıktan sonra yumuşakça açılır; hızı döngüye tam sayıda sığan en yakın hız
    const grown = smooth(g.sg.b1, g.sg.b1 + 0.1 * R.span, R.G) * R.fade;
    if (grown <= 0) continue;
    const env = Math.pow(Math.max(0, Math.sin(t * loopRate(g.rate, loop) + g.ph)), 14) * grown;
    if (env < 0.02) continue;
    sparkle(ctx, g.sg.x2, g.sg.y2, g.L * (0.6 + 0.4 * env), env, '#ffffff', 0.15);
    sparkle(ctx, g.sg.x2, g.sg.y2, g.L * 0.45, env * 0.7, '#bff0ff', Math.PI / 4 + 0.15);
    sprite(ctx, SPR.cool(), g.sg.x2, g.sg.y2, g.L * 3, env * 0.7);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function drawIce(ctx: Ctx, v: LayerView, t: number): void {
  const D = cached(v, 'ice', () => buildDendrites(iceRoots(v), 7, v.kind === 'deco' ? 1 : 2));
  if (v.loop) {
    drawIceLoop(ctx, v, t, D, v.loop);
    return;
  }
  const G = iceG(t) * D.maxB;
  if (G <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const paths = [new Path2D(), new Path2D(), new Path2D()];
  const tips: Pt[] = [];
  for (const sg of D.segs) {
    if (sg.b0 >= G) continue;
    const f = Math.min(1, (G - sg.b0) / (sg.b1 - sg.b0));
    const x2 = sg.x1 + (sg.x2 - sg.x1) * f;
    const y2 = sg.y1 + (sg.y2 - sg.y1) * f;
    paths[sg.d]!.moveTo(sg.x1, sg.y1);
    paths[sg.d]!.lineTo(x2, y2);
    if (f < 1 && sg.d === 0) tips.push([x2, y2]);
  }
  const dim = v.kind === 'card' ? 0.75 : v.kind === 'plate' ? 0.8 : 1;
  const W1 = [3.4, 2.2, 1.4];
  const W2 = [1.1, 0.8, 0.6];
  const A1 = [0.1, 0.08, 0.06];
  const A2 = [0.85, 0.65, 0.5];
  for (let d = 0; d < 3; d++) {
    ctx.strokeStyle = '#8fdcff';
    ctx.lineWidth = W1[d]!;
    ctx.globalAlpha = A1[d]! * dim;
    ctx.stroke(paths[d]!);
    ctx.strokeStyle = '#effbff';
    ctx.lineWidth = W2[d]!;
    ctx.globalAlpha = A2[d]! * dim;
    ctx.stroke(paths[d]!);
  }
  for (const p of tips) sprite(ctx, SPR.cool(), p[0], p[1], 9, 0.8 * dim);
  for (const g of D.gl) {
    if (g.sg.b1 > G) continue;
    const env = Math.pow(Math.max(0, Math.sin(t * g.rate + g.ph)), 14);
    if (env < 0.02) continue;
    sparkle(ctx, g.sg.x2, g.sg.y2, g.L * (0.6 + 0.4 * env), env, '#ffffff', 0.15);
    sparkle(ctx, g.sg.x2, g.sg.y2, g.L * 0.45, env * 0.7, '#bff0ff', Math.PI / 4 + 0.15);
    sprite(ctx, SPR.cool(), g.sg.x2, g.sg.y2, g.L * 3, env * 0.7);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- 6. Neon Yağmur: halkaya çarpan damlalar, cam üstünde kayan damlalar ----------

/**
 * Döngü biçimi (yalnızca dosyaya çizim aracı; bkz. client-core cosmeticShaders/neon.ts neonLoopShader).
 * - Dekorasyon: damlaların ve alttaki damlanın süreleri döngüye tam sayıda sığar; tur numarası döngü içinde
 *   sayıldığından aynı damlalar her döngüde aynı yere düşer.
 * - Kart: cam üstünde kayan damlalar canlıda kartın boyunu sarmalayarak sonsuza dek iner. Döngüde her damlanın
 *   bir ömrü var: belirir, birkaç adım kayar, söner, başladığı yerde yeniden belirir. Damlaların evreleri dağınık
 *   olduğundan hepsi birden yenilenmez. Avatarın yerine bakılmaz (standart tuvalde avatar efektin üstündedir).
 */
function drawNeonLoop(ctx: Ctx, v: LayerView, t: number, loop: number): void {
  if (v.kind === 'deco') {
    const cx = v.w / 2;
    const cy = v.h / 2;
    const Rr = v.R * 1.22;
    const k = v.R / 46;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const turns = Math.max(1, Math.round(loop / (1.3 + i * 0.23)));
      const D = loop / turns;
      const u = posmod(t + i * 0.71, D) / D;
      const cyc = posmod(Math.floor((t + i * 0.71) / D), turns);
      const dx = (hash(cyc * 13 + i * 101) - 0.5) * 1.5 * Rr * 0.85;
      const hitY = cy - Math.sqrt(Math.max(0, Rr * Rr - dx * dx));
      if (u < 0.45) {
        const q = u / 0.45;
        const y = -6 + (hitY + 6) * q * q;
        ctx.globalAlpha = 0.65 * smooth(0, 0.15, q);
        ctx.strokeStyle = '#d8f4ff';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + dx, y - 7 * k * q - 2);
        ctx.lineTo(cx + dx, y);
        ctx.stroke();
      } else if (u < 0.8) {
        const tau = (u - 0.45) * D;
        const fade = 1 - (u - 0.45) / 0.35;
        ctx.globalCompositeOperation = 'lighter';
        sprite(ctx, dx < 0 ? SPR.mag() : SPR.cyan(), cx + dx, hitY, 16 * k * (1 - fade * 0.3), fade * 0.8);
        ctx.fillStyle = '#e8fbff';
        for (let j = 0; j < 3; j++) {
          const vx = (j - 1) * 24 + (hash(j + cyc * 7) - 0.5) * 14;
          const vy = -26 - 18 * hash(j * 3 + cyc);
          ctx.globalAlpha = fade * 0.9;
          ctx.beginPath();
          ctx.arc(cx + dx + vx * k * tau, hitY + (vy * tau + 160 * tau * tau) * k, 0.9, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const Dd = loop / Math.max(1, Math.round(loop / 2.6));
    const u = posmod(t, Dd) / Dd;
    const bx = cx + 6 * k;
    const by = cy + Rr;
    ctx.fillStyle = '#cfefff';
    if (u < 0.7) {
      const r = 2.3 * k * easeOutBack(u / 0.7);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(bx, by + r * 0.9, Math.max(0, r * 0.8), Math.max(0, r), 0, 0, TAU);
      ctx.fill();
    } else {
      const tau = (u - 0.7) * Dd;
      ctx.globalAlpha = 0.8 * (1 - (u - 0.7) / 0.3);
      ctx.beginPath();
      ctx.ellipse(bx, by + 2 + 200 * k * tau * tau, 1.6 * k, 2.4 * k, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (v.kind !== 'card') return;
  const list = cached(v, 'dropsLoop', () => {
    const r = rng(61);
    return Array.from({ length: 12 }, () => ({ x: 0.04 + r() * 0.92, y: r(), f: 0.25 + r() * 0.35, st: 18 + r() * 30, rad: 1.6 + r() * 1.8, ph: r() }));
  });
  for (const o of list) {
    // ömür: döngü boyunca tam sayıda adım; başta belirir, sonda söner
    const steps = Math.max(1, Math.round(o.f * loop));
    const s = posmod(t / loop + o.ph, 1);
    const env = smooth(0, 0.07, s) * (1 - smooth(0.9, 1, s));
    if (env <= 0.003) continue;
    const tt = s * steps;
    const step = Math.floor(tt);
    const e = easeOutBack(clamp((tt - step) / 0.35));
    const jitter = (n: number): number => Math.sin(n * 1.7 + o.ph * 10) * 2;
    const x = o.x * v.w + mix(jitter(step), jitter(step + 1), clamp(e));
    const yy = -10 + o.y * Math.max(40, v.h * 0.8 - steps * o.st) + (step + e) * o.st;
    const trail = ctx.createLinearGradient(x, yy - 40, x, yy);
    trail.addColorStop(0, 'rgba(180,220,255,0)');
    trail.addColorStop(1, 'rgba(180,220,255,.16)');
    ctx.globalAlpha = env;
    ctx.strokeStyle = trail;
    ctx.lineWidth = o.rad * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, yy - 40);
    ctx.lineTo(x, yy);
    ctx.stroke();
    ctx.globalAlpha = 0.22 * env;
    ctx.fillStyle = '#bfe3ff';
    ctx.beginPath();
    ctx.ellipse(x, yy, o.rad, o.rad * 1.18, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.75 * env;
    ctx.strokeStyle = '#ff5bd8';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, yy + o.rad * 0.15, o.rad * 0.85, 0.3, 1.4);
    ctx.stroke();
    ctx.strokeStyle = '#5fe8ff';
    ctx.beginPath();
    ctx.arc(x, yy + o.rad * 0.15, o.rad * 0.85, 1.7, 2.8);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * env;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - o.rad * 0.35, yy - o.rad * 0.4, o.rad * 0.28, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawNeon(ctx: Ctx, v: LayerView, t: number): void {
  if (v.loop) {
    drawNeonLoop(ctx, v, t, v.loop);
    return;
  }
  if (v.kind === 'deco') {
    const cx = v.w / 2;
    const cy = v.h / 2;
    const Rr = v.R * 1.22;
    const k = v.R / 46;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const D = 1.3 + i * 0.23;
      const u = posmod(t + i * 0.71, D) / D;
      const cyc = Math.floor((t + i * 0.71) / D);
      const dx = (hash(cyc * 13 + i * 101) - 0.5) * 1.5 * Rr * 0.85;
      const hitY = cy - Math.sqrt(Math.max(0, Rr * Rr - dx * dx));
      if (u < 0.45) {
        const q = u / 0.45;
        const y = -6 + (hitY + 6) * q * q;
        ctx.globalAlpha = 0.65 * smooth(0, 0.15, q);
        ctx.strokeStyle = '#d8f4ff';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + dx, y - 7 * k * q - 2);
        ctx.lineTo(cx + dx, y);
        ctx.stroke();
      } else if (u < 0.8) {
        const tau = (u - 0.45) * D;
        const fade = 1 - (u - 0.45) / 0.35;
        ctx.globalCompositeOperation = 'lighter';
        sprite(ctx, dx < 0 ? SPR.mag() : SPR.cyan(), cx + dx, hitY, 16 * k * (1 - fade * 0.3), fade * 0.8);
        ctx.fillStyle = '#e8fbff';
        for (let j = 0; j < 3; j++) {
          const vx = (j - 1) * 24 + (hash(j + cyc * 7) - 0.5) * 14;
          const vy = -26 - 18 * hash(j * 3 + cyc);
          const x = cx + dx + vx * k * tau;
          const y = hitY + (vy * tau + 160 * tau * tau) * k;
          ctx.globalAlpha = fade * 0.9;
          ctx.beginPath();
          ctx.arc(x, y, 0.9, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const Dd = 2.6;
    const u = posmod(t, Dd) / Dd;
    const bx = cx + 6 * k;
    const by = cy + Rr;
    ctx.fillStyle = '#cfefff';
    if (u < 0.7) {
      const r = 2.3 * k * easeOutBack(u / 0.7);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(bx, by + r * 0.9, Math.max(0, r * 0.8), Math.max(0, r), 0, 0, TAU);
      ctx.fill();
    } else {
      const tau = (u - 0.7) * Dd;
      const y = by + 2 + 200 * k * tau * tau;
      ctx.globalAlpha = 0.8 * (1 - (u - 0.7) / 0.3);
      ctx.beginPath();
      ctx.ellipse(bx, y, 1.6 * k, 2.4 * k, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (v.kind !== 'card') return;
  const list = cached(v, 'drops', () => {
    const r = rng(61);
    return Array.from({ length: 9 }, () => ({ x: 0.04 + r() * 0.92, y: r(), f: 0.25 + r() * 0.35, st: 18 + r() * 30, rad: 1.6 + r() * 1.8, ph: r() * 10 }));
  });
  const H = v.h + 30;
  for (const o of list) {
    const tt = t * o.f + o.ph;
    const step = Math.floor(tt);
    const fr = tt - step;
    const yy = posmod(o.y * H + (step + easeOutBack(clamp(fr / 0.35))) * o.st, H) - 15;
    const x = o.x * v.w + Math.sin(step * 1.7 + o.ph) * 2;
    if (Math.hypot(x - v.geo.ax, yy - v.geo.ay) < v.geo.ar + 4) continue;
    const trail = ctx.createLinearGradient(x, yy - 40, x, yy);
    trail.addColorStop(0, 'rgba(180,220,255,0)');
    trail.addColorStop(1, 'rgba(180,220,255,.16)');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = trail;
    ctx.lineWidth = o.rad * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, yy - 40);
    ctx.lineTo(x, yy);
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#bfe3ff';
    ctx.beginPath();
    ctx.ellipse(x, yy, o.rad, o.rad * 1.18, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#ff5bd8';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, yy + o.rad * 0.15, o.rad * 0.85, 0.3, 1.4);
    ctx.stroke();
    ctx.strokeStyle = '#5fe8ff';
    ctx.beginPath();
    ctx.arc(x, yy + o.rad * 0.15, o.rad * 0.85, 1.7, 2.8);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - o.rad * 0.35, yy - o.rad * 0.4, o.rad * 0.28, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- WebGL yoksa: sade 2B zeminler ----------

export function drawFallback(ctx: Ctx, v: LayerView, set: CosmeticSet): void {
  const W = v.w;
  const H = v.h;
  const P = COSMETIC_SET_INFO[set].fallback;
  if (set === 'karadelik') {
    const L = bhLayout(v);
    if (v.kind === 'thumb' || v.kind === 'plate') {
      ctx.fillStyle = '#040308';
      ctx.fillRect(0, 0, W, H);
    }
    if (v.kind === 'card') {
      const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.RS * 6);
      g.addColorStop(0, 'rgba(3,2,8,.95)');
      g.addColorStop(1, 'rgba(3,2,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(0.12);
    ctx.scale(1, v.kind === 'deco' ? 0.3 : 0.2);
    const ro = v.kind === 'deco' ? W * 0.49 : L.RS * 3.6;
    const g = ctx.createRadialGradient(0, 0, L.RS * 1.1, 0, 0, ro);
    g.addColorStop(0, 'rgba(255,230,180,.95)');
    g.addColorStop(0.35, 'rgba(255,130,40,.7)');
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, TAU);
    ctx.arc(0, 0, L.RS * 1.1, 0, TAU, true);
    ctx.fill();
    ctx.restore();
    if (v.kind !== 'deco') {
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.RS, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,225,180,.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.RS * 1.03, 0, TAU);
    ctx.stroke();
    return;
  }
  if (v.kind === 'plate') {
    // plaka: koyu zemin, setin rengi ve parıltısı yalnızca sağda (solu drawPlateScrim de koyulaştırır)
    ctx.fillStyle = P[0];
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(W * 0.3, 0, W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, P[1]);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    const rg = ctx.createRadialGradient(W * 0.9, H * 0.35, 0, W * 0.9, H * 0.35, W * 0.35);
    rg.addColorStop(0, P[2]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  } else if (v.kind === 'thumb') {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, P[0]);
    g.addColorStop(1, P[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.78, H * 0.25, 0, W * 0.78, H * 0.25, Math.max(W, H) * 0.6);
    rg.addColorStop(0, P[2]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  } else if (v.kind === 'card') {
    const bh = v.geo.bh;
    const rg = ctx.createRadialGradient(W * 0.75, bh * 0.3, 0, W * 0.75, bh * 0.3, bh * 1.6);
    rg.addColorStop(0, P[2]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, bh * 1.6);
  } else {
    const R = v.R;
    const rg = ctx.createRadialGradient(W / 2, H / 2, R * 0.95, W / 2, H / 2, W / 2);
    rg.addColorStop(0, P[2]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2, 0, TAU);
    ctx.arc(W / 2, H / 2, R, 0, TAU, true);
    ctx.fill();
  }
}

/**
 * İsim plakasının son adımı (gölgelendirici ya da yedek zemin ve 2B katman çizildikten sonra): soldan sağa
 * açılan, setin koyu renginde bir perde. Avatar, ad ve durumun altı her karede sakin ve koyu kalır (parçacık,
 * pırıltı, yağmur çizgisi yazıların altında seçilmez); sahne sağda tam görünür. Setlerin ayrıca kendi
 * gölgelendiricisinde plateGrade (parlaklık sınırı ve solma) var.
 */
export function drawPlateScrim(ctx: Ctx, v: LayerView, set: CosmeticSet): void {
  const tint = COSMETIC_SET_INFO[set].fallback[0];
  const n = parseInt(tint.slice(1), 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const g = ctx.createLinearGradient(0, 0, v.w, 0);
  for (const [at, a] of PLATE_SCRIM) g.addColorStop(at, `rgba(${rgb},${a})`);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.w, v.h);
}
/** Perdenin durakları: (satır genişliğine oran, örtücülük); yumuşak iniş, keskin kenar yok */
const PLATE_SCRIM: [number, number][] = [
  [0, 0.86],
  [0.3, 0.78],
  [0.45, 0.52],
  [0.6, 0.24],
  [0.72, 0.07],
  [0.8, 0],
];

/** Setlerin 2B katmanları (gölgelendiricinin üstüne; WebGL yokken yedek zeminin üstüne) */
export const LAYERS: Record<CosmeticSet, (ctx: Ctx, v: LayerView, t: number) => void> = {
  karadelik: drawKaradelik,
  sakura: drawSakura,
  kuzey: drawAurora,
  atesbocegi: drawForest,
  buz: drawIce,
  neon: drawNeon,
};
