// Hareketli kozmetik setlerinin 2B katmanları (telefon, Skia): gölgelendiricinin üstüne çizilen ayrıntılar
// (içeri çekilen yıldızlar, açan çiçekler, ateşböcekleri, buz dendritleri, damlalar) ve gölgelendirici
// derlenemezse sade 2B zeminler. Masaüstünün Canvas 2D katmanlarından (desktop cosmetics/layers.ts)
// aktarıldı: aynı tohumlar, aynı formüller. Farklar: parıltı resimleri yerine birim çemberde radyal
// degrade, "lighter" yerine Skia'nın Plus karışımı, buz dendritleri her karede kurulmaz (hazır yollar
// kırpılarak açılır). Skia bu modüle dışarıdan verilir (yerel modülü olmayan uygulamada hiç yüklenmez).

import type { CosmeticSet } from '@diskort/shared';
import { COSMETIC_SET_INFO, type ShaderViewKind } from '@diskort/client-core';
import type { Skia as SkiaApi, SkCanvas, SkColor, SkPaint, SkPath, SkShader } from '@shopify/react-native-skia';

/** Skia'nın JSI nesnesi (telefonda yerel, testte CanvasKit üstünde aynı arayüz) */
type Skia = typeof SkiaApi;
import { PLATE } from './plate';

/** Profil kartının ölçüleri (px): afiş yüksekliği, avatar merkezi ve dış yarıçapı */
export interface CardGeo {
  bh: number;
  ax: number;
  ay: number;
  ar: number;
}

/** Bir çizim yüzeyi (katmanların gördüğü kadarı) */
export interface LayerView {
  kind: ShaderViewKind;
  /** Boyut (px) */
  w: number;
  h: number;
  /** Boyuta bağlı hazır listeler (parçacıklar, dendritler) */
  cache: Map<string, unknown>;
  geo: CardGeo;
  /** Dekorasyonda avatarın yarıçapı (px) */
  R: number;
}

type Pt = [number, number];

// Skia'nın sayı değerli sabitleri (enum'lar paketten alınamaz: paket yalnızca geç yüklenir)
const BLEND_SRC_OVER = 3;
const BLEND_PLUS = 12;
const STYLE_FILL = 0;
const STYLE_STROKE = 1;
const CAP_ROUND = 1;
const TILE_CLAMP = 0;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
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

/** Sabit tohumlu rastgele sayı üreteci (mulberry32): her açılışta aynı görünüm (masaüstüyle aynı) */
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

// ---------- Kalıcı Skia nesneleri (bir kez kurulur) ----------

type GlowKind = 'ff' | 'ffb' | 'warm' | 'cool' | 'mag' | 'cyan';
const GLOWS: Record<GlowKind, [number, string][]> = {
  ff: [[0, 'rgba(255,255,230,1)'], [0.1, 'rgba(245,255,160,.95)'], [0.3, 'rgba(200,245,100,.32)'], [0.6, 'rgba(150,220,70,.08)'], [1, 'rgba(120,200,60,0)']],
  ffb: [[0, 'rgba(230,255,150,.35)'], [0.7, 'rgba(210,250,120,.22)'], [0.85, 'rgba(210,250,120,.1)'], [1, 'rgba(200,240,100,0)']],
  warm: [[0, 'rgba(255,250,235,1)'], [0.15, 'rgba(255,200,120,.8)'], [0.45, 'rgba(255,120,40,.18)'], [1, 'rgba(255,90,20,0)']],
  cool: [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(200,240,255,.7)'], [0.5, 'rgba(120,200,255,.12)'], [1, 'rgba(100,180,255,0)']],
  mag: [[0, 'rgba(255,240,255,1)'], [0.2, 'rgba(255,80,220,.6)'], [0.55, 'rgba(255,40,200,.12)'], [1, 'rgba(255,0,200,0)']],
  cyan: [[0, 'rgba(240,255,255,1)'], [0.2, 'rgba(60,230,255,.6)'], [0.55, 'rgba(20,200,255,.12)'], [1, 'rgba(0,180,255,0)']],
};

interface Res {
  S: Skia;
  paint: SkPaint;
  colors: Map<string, SkColor>;
  glow: Record<GlowKind, SkShader>;
  petal: SkPath;
  fpetal: SkPath;
  leaf: SkPath;
  sparkle: SkPath;
  branch: { main: SkPath; tw1: SkPath; tw2: SkPath; hi: SkPath };
  fills: { a: SkShader; b: SkShader; fl: SkShader; lf: SkShader };
}

let res: Res | null = null;

function resources(S: Skia): Res {
  if (res && res.S === S) return res;
  const colors = new Map<string, SkColor>();
  const col = (c: string): SkColor => {
    const known = colors.get(c);
    if (known) return known;
    const v = S.Color(c);
    colors.set(c, v);
    return v;
  };
  const radial = (stops: [number, string][]): SkShader =>
    S.Shader.MakeRadialGradient(S.Point(0, 0), 1, stops.map((s) => col(s[1])), stops.map((s) => s[0]), TILE_CLAMP);
  const linear = (y0: number, y1: number, stops: [number, string][]): SkShader =>
    S.Shader.MakeLinearGradient(S.Point(0, y0), S.Point(0, y1), stops.map((s) => col(s[1])), stops.map((s) => s[0]), TILE_CLAMP);
  const svg = (d: string): SkPath => S.Path.MakeFromSVGString(d) ?? S.Path.Make();
  // Dört köşeli pırıltı yıldızı (L=1): yatay kol ve 0.8 boyunda dikey kol
  const w = 0.13;
  const sparkle = svg(`M-1 0 L0 ${-w} L1 0 L0 ${w} Z M0 -0.8 L${w} 0 L0 0.8 L${-w} 0 Z`);
  const curve = (pts: Pt[]): SkPath => {
    const p = S.Path.Make();
    p.moveTo(pts[0]![0], pts[0]![1]);
    if (pts.length === 4) p.cubicTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1], pts[3]![0], pts[3]![1]);
    else p.quadTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    return p;
  };
  const paint = S.Paint();
  paint.setAntiAlias(true);
  res = {
    S,
    paint,
    colors,
    glow: Object.fromEntries((Object.keys(GLOWS) as GlowKind[]).map((k) => [k, radial(GLOWS[k])])) as Record<GlowKind, SkShader>,
    petal: svg('M0 -0.5 C0.36 -0.36 0.44 0.1 0.21 0.5 L0 0.36 L-0.21 0.5 C-0.44 0.1 -0.36 -0.36 0 -0.5Z'),
    fpetal: svg('M0 0 C0.36 0.14 0.44 0.6 0.21 1 L0 0.86 L-0.21 1 C-0.44 0.6 -0.36 0.14 0 0Z'),
    leaf: svg('M0 0 Q0.45 0.42 0 1 Q-0.45 0.42 0 0Z'),
    sparkle,
    branch: {
      main: curve(BRANCH.main),
      tw1: curve(BRANCH.tw1),
      tw2: curve(BRANCH.tw2),
      hi: curve(BRANCH.main.map((p) => [p[0], p[1] - 1.2] as Pt)),
    },
    fills: {
      a: linear(-0.5, 0.5, [[0, '#fff3f7'], [0.55, '#ffc4d7'], [1, '#f48ab0']]),
      b: linear(-0.5, 0.5, [[0, '#fbe6ee'], [1, '#e8a9c1']]),
      fl: linear(0, 1, [[0, '#fff8fb'], [0.45, '#ffd2e0'], [1, '#f28bb2']]),
      lf: linear(0, 1, [[0, '#3f7a34'], [1, '#a6d672']]),
    },
  };
  return res;
}

/**
 * Çizim kalemi: Canvas 2D'nin durum makinesinin (globalAlpha, globalCompositeOperation, fillStyle...)
 * Skia karşılığı. Tek boya nesnesi her çizimden önce ayarlanır (Skia çizim anında boyayı kopyalar).
 */
export class Pen {
  readonly S: Skia;
  readonly c: SkCanvas;
  readonly r: Res;
  /** Canvas 2D'deki "lighter" (toplamalı karışım) açık mı */
  add = false;

  constructor(S: Skia, canvas: SkCanvas) {
    this.S = S;
    this.c = canvas;
    this.r = resources(S);
  }

  private color(css: string): SkColor {
    const known = this.r.colors.get(css);
    if (known) return known;
    const v = this.S.Color(css);
    this.r.colors.set(css, v);
    return v;
  }

  /** Düz renkle dolgu boyası (alpha rengin kendi saydamlığıyla çarpılır) */
  fill(css: string, alpha: number): SkPaint {
    return this.setup(css, alpha, STYLE_FILL, 0, null);
  }

  stroke(css: string, alpha: number, width: number): SkPaint {
    return this.setup(css, alpha, STYLE_STROKE, width, null);
  }

  /** Degradeli dolgu (ya da çizgi: width > 0) */
  shade(shader: SkShader, alpha: number, width = 0): SkPaint {
    return this.setup('#ffffff', alpha, width > 0 ? STYLE_STROKE : STYLE_FILL, width, shader);
  }

  private setup(css: string, alpha: number, style: number, width: number, shader: SkShader | null): SkPaint {
    const p = this.r.paint;
    const col = this.color(css);
    p.setShader(shader);
    p.setColor(col);
    p.setAlphaf(clamp(alpha) * (col[3] ?? 1));
    p.setStyle(style);
    if (style === STYLE_STROKE) {
      p.setStrokeWidth(width);
      p.setStrokeCap(CAP_ROUND);
    }
    p.setBlendMode(this.add ? BLEND_PLUS : BLEND_SRC_OVER);
    return p;
  }

  line(x0: number, y0: number, x1: number, y1: number, paint: SkPaint): void {
    this.c.drawLine(x0, y0, x1, y1, paint);
  }

  circle(x: number, y: number, r: number, paint: SkPaint): void {
    if (r > 0) this.c.drawCircle(x, y, r, paint);
  }

  ellipse(x: number, y: number, rx: number, ry: number, rot: number, paint: SkPaint): void {
    if (rx <= 0 || ry <= 0) return;
    this.c.save();
    this.c.translate(x, y);
    if (rot) this.c.rotate(rot * DEG, 0, 0);
    this.c.drawOval(this.S.XYWHRect(-rx, -ry, rx * 2, ry * 2), paint);
    this.c.restore();
  }

  /** Canvas 2D setTransform(a, b, c, d, e, f) ile yol çizimi (css pikseli; kaydedip geri alır) */
  path(path: SkPath, m: [number, number, number, number, number, number], paint: SkPaint): void {
    this.c.save();
    this.c.concat([m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1]);
    this.c.drawPath(path, paint);
    this.c.restore();
  }

  /** Parıltı: merkezde parlak, kenara doğru sönen yuvarlak (masaüstündeki parıltı resmi); size çapı */
  glow(kind: GlowKind, x: number, y: number, size: number, alpha: number): void {
    if (alpha <= 0.003 || size <= 0) return;
    const p = this.shade(this.r.glow[kind], Math.min(1, alpha));
    const r = size / 2;
    this.c.save();
    this.c.translate(x, y);
    this.c.scale(r, r);
    this.c.drawCircle(0, 0, 1, p);
    this.c.restore();
  }

  /** Dört köşeli pırıltı yıldızı */
  sparkle(x: number, y: number, L: number, alpha: number, css: string, rot = 0): void {
    if (alpha <= 0.003 || L <= 0) return;
    const p = this.fill(css, Math.min(1, alpha));
    this.c.save();
    this.c.translate(x, y);
    if (rot) this.c.rotate(rot * DEG, 0, 0);
    this.c.scale(L, L);
    this.c.drawPath(this.r.sparkle, p);
    this.c.restore();
  }
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
  if (v.kind === 'plate') return PLATE.karadelik.hole(v.w, v.h);
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

function drawKaradelik(g: Pen, v: LayerView, t: number): void {
  const { cx, cy, RS } = bhLayout(v);
  g.add = true;
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
      g.glow('warm', x, y, o.sz * (0.8 + 0.3 * dop), 0.55 * dop);
    }
    g.add = false;
    return;
  }
  const n = v.kind === 'card' ? 30 : v.kind === 'plate' ? PLATE.karadelik.stars : 16;
  const rMax =
    v.kind === 'card' ? Math.max(v.w, v.h) * 0.95 : v.kind === 'plate' ? v.w * PLATE.karadelik.reach : Math.max(v.w, v.h) * 0.65;
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
      g.line(px, py, q[0], q[1], g.stroke(col, al * (1 - k / (steps + 1)) * 0.7, o.w * (1 - k / (steps + 1)) * (1 + heat)));
      px = q[0];
      py = q[1];
    }
    // gelgit uzaması: merkeze doğru (radyal) çekilir
    const st = Math.min(RS * 1.3, (RS * RS * 2.2) / r) * heat;
    if (st > 0.5) {
      const dx = (h[0] - cx) / r;
      const dy = (h[1] - cy) / r;
      g.line(h[0] - dx * st, h[1] - dy * st, h[0] + dx * st * 0.6, h[1] + dy * st * 0.6, g.stroke(col, al * 0.8, o.w * 0.9));
    }
    g.glow(heat > 0.5 ? 'warm' : 'cool', h[0], h[1], 7 + 6 * o.w + 8 * heat, al);
  }
  g.add = false;
}

// ---------- 2. Sakura: dal, açan çiçekler, rüzgârda takla atan yapraklar, asma çelengi ----------

/** Üç boyutlu dönen yaprak: yerel eksenler döndürülüp 2B afin dönüşüme indirgenir (kısalma kendiliğinden oluşur) */
function petal3D(g: Pen, x: number, y: number, size: number, ax: number, ay: number, az: number, alpha: number): void {
  if (alpha <= 0.003) return;
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
  const s = size;
  const F = g.r.fills;
  const P = g.r.petal;
  g.c.save();
  g.c.concat([Ux * s, Vx * s, x, Uy * s, Vy * s, y, 0, 0, 1]);
  g.c.drawPath(P, g.shade(Nz >= 0 ? F.a : F.b, alpha));
  const lam = Math.abs(-0.35 * Nx - 0.55 * Ny + 0.76 * Nz);
  const dark = (1 - lam) * 0.55;
  if (dark > 0.03) g.c.drawPath(P, g.fill('#5a1636', alpha * dark));
  if (lam > 0.86) g.c.drawPath(P, g.fill('#ffffff', alpha * (lam - 0.86) * 2.6));
  g.c.restore();
}

function flower(g: Pen, x: number, y: number, size: number, open: number, rot: number, alpha: number): void {
  if (alpha <= 0.01 || open <= 0.01) return;
  const k = 0.3 + 0.7 * open;
  const tilt = 0.84;
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * TAU) / 5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const sx = size * k * (0.65 + 0.35 * open);
    const sy = size * k;
    g.c.save();
    g.c.concat([c * sx, -s * sy, x, s * sx * tilt, c * sy * tilt, y, 0, 0, 1]);
    g.c.drawPath(g.r.fpetal, g.shade(g.r.fills.fl, alpha));
    if (i % 2) g.c.drawPath(g.r.fpetal, g.fill('#7a1f48', alpha * 0.14));
    g.c.restore();
  }
  g.circle(x, y, size * 0.17 * k, g.fill('#d9467a', alpha));
  const st = smooth(0.45, 1, open);
  if (st > 0) {
    const L = size * 0.45 * st;
    const line = g.stroke('#f7a3c0', alpha, 0.6);
    for (let i = 0; i < 7; i++) {
      const a = rot * 1.3 + (i * TAU) / 7;
      g.line(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L * tilt, line);
    }
    const dot = g.fill('#ffd36b', alpha);
    for (let i = 0; i < 7; i++) {
      const a = rot * 1.3 + (i * TAU) / 7;
      g.circle(x + Math.cos(a) * L, y + Math.sin(a) * L * tilt, 0.95, dot);
    }
  }
}

function bud(g: Pen, x: number, y: number, size: number, alpha: number): void {
  if (alpha <= 0.01) return;
  g.ellipse(x, y, size * 0.22, size * 0.3, 0.4, g.fill('#e46f98', alpha));
  g.ellipse(x - size * 0.08, y + size * 0.2, size * 0.12, size * 0.08, 0.4, g.fill('#6e3a2c', alpha));
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

function drawPetals(g: Pen, v: LayerView, t: number, list: Petal[], dimBody: boolean): void {
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
    petal3D(
      g,
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

function drawBranch(g: Pen, v: LayerView, t: number, ax: number, ay: number, sc: number): void {
  const B = g.r.branch;
  g.c.save();
  g.c.translate(ax, ay);
  g.c.scale(sc, sc);
  g.c.drawPath(B.main, g.stroke('#24121b', 1, 5));
  g.c.drawPath(B.tw1, g.stroke('#24121b', 1, 2.8));
  g.c.drawPath(B.tw2, g.stroke('#24121b', 1, 2.4));
  g.c.drawPath(B.hi, g.stroke('#6b3a4c', 0.55, 1.4));
  g.c.restore();
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
    bud(g, bx, by, size, budA);
    flower(g, bx, by, size, open * (s > 0.8 ? 0 : 1), j * 1.3 + 0.08 * Math.sin(t * 0.8 + j), pa);
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
        petal3D(g, X, Y, size * 0.62, a + age * (1.5 + hk * 2), age * (2 + hk), a + age * 0.6, 0.92 * (1 - smooth(7, 9, age)));
      }
    }
  });
}

function drawWreath(g: Pen, v: LayerView, t: number): void {
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
      const e = Math.min(1, (G - pts[i - 1]![2]) / (u - pts[i - 1]![2]));
      g.line(
        pts[i - 1]![0],
        pts[i - 1]![1],
        mix(pts[i - 1]![0], pts[i]![0], e),
        mix(pts[i - 1]![1], pts[i]![1], e),
        g.stroke('#3b5b2a', fadeA, (3 - u * 1.4) * (0.3 + 0.7 * tip) * k),
      );
    }
    for (let i = 3; i < N; i += 5) {
      const u = pts[i]![2];
      const gg = clamp((G - u) * 9);
      if (gg <= 0) continue;
      const tang = Math.atan2(pts[i + 1]![1] - pts[i - 1]![1], pts[i + 1]![0] - pts[i - 1]![0]);
      const side = (i / 5) % 2 < 1 ? 1 : -1;
      const a = tang + side * 1.0 + 0.06 * Math.sin(t * 1.3 + i);
      const sz = 7.5 * k * easeOutBack(gg) * (1 - u * 0.25);
      const c = Math.cos(a - Math.PI / 2);
      const sn = Math.sin(a - Math.PI / 2);
      g.path(g.r.leaf, [c * sz * 0.9, sn * sz * 0.9, -sn * sz, c * sz, pts[i]![0], pts[i]![1]], g.shade(g.r.fills.lf, fadeA));
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
    bud(g, f.x, f.y, f.size * 0.8, fadeA * (1 - smooth(0.1, 0.4, f.g)));
    flower(g, f.x, f.y, f.size, open, f.rot + 0.07 * Math.sin(t * 1.1 + f.key), fadeA * petalA);
    if (G >= 1 && petalA > 0.5) {
      const tw = Math.pow(Math.max(0, Math.sin(t * 1.7 + f.key * 2.1)), 12);
      g.add = true;
      g.sparkle(f.x + f.size * 0.9, f.y - f.size * 0.7, 4.5 * k, tw * 0.9, '#fff', 0.3);
      g.add = false;
    }
    if (s > 0.8) {
      const age = (s - 0.8) * P;
      for (let j = 0; j < 5; j++) {
        const a = f.rot + (j * TAU) / 5;
        const hk = hash((j * 31 + f.key * 7) | 0);
        const X = f.x + Math.cos(a) * f.size * 0.5 + (hk - 0.5) * 16 * k * age + 5 * k * Math.sin(age * 2 + j);
        const Y = f.y + Math.sin(a) * f.size * 0.4 + (10 + 14 * hk) * k * age + 4 * k * age * age;
        petal3D(g, X, Y, f.size * 0.55, a + age * 3, age * (2 + hk * 2), a, 0.9 * (1 - smooth(1.6, 2.4, age)));
      }
    }
  }
}

function drawSakura(g: Pen, v: LayerView, t: number): void {
  if (v.kind === 'deco') drawWreath(g, v, t);
  else if (v.kind === 'card') {
    drawPetals(g, v, t, petalSet(v, 22, 1), true);
    drawBranch(g, v, t, v.w, 0, v.geo.bh / 118);
  } else if (v.kind === 'thumb') {
    drawBranch(g, v, t, v.w, 0, v.h / 150);
    drawPetals(g, v, t, petalSet(v, 14, 0.8), false);
  } else {
    const P = PLATE.sakura;
    drawPetals(g, v, t, petalSet(v, P.petals, P.petalScale), false);
    drawBranch(g, v, t, v.w + P.branch.dx, P.branch.y, P.branch.scale);
  }
}

// ---------- 3. Kuzey Işıkları: kayan yıldız, halkada pırıltı ----------

function shootingStar(g: Pen, t: number, W: number, yMax: number, seed: number): void {
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
  const tx = hx - Math.cos(ang) * tl;
  const ty = hy - Math.sin(ang) * tl;
  const S = g.S;
  const grad = S.Shader.MakeLinearGradient(
    S.Point(hx, hy),
    S.Point(tx, ty),
    [S.Color('rgba(230,255,245,1)'), S.Color('rgba(120,255,200,0)')],
    null,
    TILE_CLAMP,
  );
  g.line(hx, hy, tx, ty, g.shade(grad, a, 1.3));
  g.add = true;
  g.glow('cool', hx, hy, 10, a);
  g.add = false;
  grad.dispose?.();
}

function drawAurora(g: Pen, v: LayerView, t: number): void {
  if (v.kind === 'deco') {
    const list = cached(v, 'ast', () => {
      const r = rng(3);
      return Array.from({ length: 7 }, () => ({ a: r() * TAU, rr: 1.15 + r() * 0.3, ph: r() * TAU, sp: 1 + r() * 1.5, L: 3 + r() * 3 }));
    });
    const k = v.R / 46;
    g.add = true;
    for (const o of list) {
      const tw = Math.pow(Math.max(0, Math.sin(t * o.sp + o.ph)), 6);
      const x = v.w / 2 + Math.cos(o.a + t * 0.05) * v.R * o.rr;
      const y = v.h / 2 + Math.sin(o.a + t * 0.05) * v.R * o.rr;
      g.sparkle(x, y, o.L * k, tw, '#eafff6', 0);
      g.glow('cool', x, y, o.L * 3 * k, tw * 0.5);
    }
    g.add = false;
    return;
  }
  if (v.kind === 'card') shootingStar(g, t, v.w, v.geo.bh, 1.3);
  else if (v.kind === 'thumb') shootingStar(g, t, v.w, v.h * 0.6, 3.1);
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

function drawForest(g: Pen, v: LayerView, t: number): void {
  g.add = true;
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
      g.glow('ff', x, y, (9 + 7 * (Z + 1)) * k * (0.7 + 0.3 * b), b * (0.55 + (0.35 * (Z + 1)) / 2));
    }
  } else {
    const plate = v.kind === 'plate';
    const PL = PLATE.atesbocegi;
    // kartta daha çok ateşböceği (vitrinde seyrek kalıyordu)
    const n = v.kind === 'card' ? 34 : plate ? PL.fireflies : 14;
    const W = v.w;
    const H = v.h;
    const y0 = plate ? PL.inset : H * 0.1;
    const y1 = plate ? H - PL.inset : H * 0.95;
    for (const o of ffList(v, n)) {
      let x = o.x * W + o.ax * Math.sin(t * o.fx + o.ph) + o.ax * 0.4 * Math.sin(t * o.fx * 2.7 + o.ph * 1.7) + o.dx * t;
      x = posmod(x + 20, W + 40) - 20;
      const y =
        y0 +
        o.y * (y1 - y0) +
        (plate ? PL.sway : 1) * (o.ay * Math.sin(t * o.fy + o.ph * 2.1) + o.ay * 0.3 * Math.cos(t * o.fy * 3.1 + o.ph));
      const b = blinkOf(o, t);
      let dim = 1;
      if (v.kind === 'card' && y > v.geo.bh) dim = 0.7;
      if (plate) dim = mix(PL.dim.from, 1, smooth(W * PL.dim.x0, W * PL.dim.x1, x));
      const sz = (plate ? PL.size : 1) * (8 + 22 * o.z * o.z) * (0.6 + 0.4 * b);
      if (o.z > 0.85 && !plate) g.glow('ffb', x, y, sz * 2.2, b * 0.5 * dim);
      g.glow('ff', x, y, sz, b * (0.35 + 0.65 * o.z) * dim);
    }
  }
  g.add = false;
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
}
/** Bir kolun (arm() çağrısı) kırık çizgisi: tek yol, doğduğu an ve boyu (yol kırpılarak açılır) */
interface Arm {
  d: number;
  birth: number;
  len: number;
  pts: Pt[];
  path: SkPath | null;
}
interface Dendrites {
  segs: Seg[];
  arms: Arm[];
  maxB: number;
  gl: { sg: Seg; ph: number; rate: number; L: number }[];
  /** Derinlik başına bütün kollar tek yolda (tamamen büyümüşken) */
  full: SkPath[] | null;
}
interface Root {
  x: number;
  y: number;
  a: number;
  len: number;
  delay?: number;
}

/** Dendritlerin geometrisi (Skia'sız; masaüstündeki buildDendrites ile aynı sırayla aynı rastgele sayılar) */
export function buildDendrites(roots: readonly Root[], seed: number, maxDepth: number): Dendrites {
  const r = rng(seed);
  const segs: Seg[] = [];
  const arms: Arm[] = [];
  let maxB = 0;
  const arm = (x: number, y: number, ang: number, len: number, depth: number, birth: number): void => {
    const steps = depth === 0 ? 6 : depth === 1 ? 4 : 2;
    const sl = len / steps;
    const me: Arm = { d: depth, birth, len, pts: [[x, y]], path: null };
    arms.push(me);
    let px = x;
    let py = y;
    let b = birth;
    for (let i = 0; i < steps; i++) {
      const a = ang + (r() - 0.5) * 0.12;
      const nx = px + Math.cos(a) * sl;
      const ny = py + Math.sin(a) * sl;
      segs.push({ x1: px, y1: py, x2: nx, y2: ny, b0: b, b1: b + sl, d: depth });
      me.pts.push([nx, ny]);
      b += sl;
      maxB = Math.max(maxB, b);
      if (depth < maxDepth) {
        const side = len * (depth === 0 ? 0.42 : 0.36) * (1 - (i / steps) * 0.6) * (0.7 + 0.5 * r());
        if (r() < 0.8) arm(nx, ny, a + Math.PI / 3, side, depth + 1, b);
        if (r() < 0.8) arm(nx, ny, a - Math.PI / 3, side, depth + 1, b);
      }
      px = nx;
      py = ny;
    }
  };
  for (const o of roots) arm(o.x, o.y, o.a, o.len, 0, o.delay ?? 0);
  const gl: Dendrites['gl'] = [];
  const rr = rng(seed + 9);
  for (let i = 0; i < 16 && segs.length; i++) {
    const sg = segs[Math.floor(rr() * segs.length)]!;
    gl.push({ sg, ph: rr() * TAU, rate: 1.2 + rr() * 1.8, L: 4 + rr() * 6 });
  }
  return { segs, arms, maxB, gl, full: null };
}

/** Kırık çizginin f oranındaki noktası (kolun parçaları eşit boyda: oran uzunluk oranıdır) */
export function armPoint(a: Pick<Arm, 'pts' | 'len'>, f: number): Pt {
  const n = a.pts.length - 1;
  const x = clamp(f) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const k = x - i;
  const p = a.pts[i]!;
  const q = a.pts[i + 1]!;
  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
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
    out.push(...PLATE.buz.roots(W, H));
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

const ICE_W1 = [3.4, 2.2, 1.4];
const ICE_W2 = [1.1, 0.8, 0.6];
const ICE_A1 = [0.1, 0.08, 0.06];
const ICE_A2 = [0.85, 0.65, 0.5];

function drawIce(g: Pen, v: LayerView, t: number): void {
  const S = g.S;
  const D = cached(v, 'ice', () => buildDendrites(iceRoots(v), 7, v.kind === 'deco' ? 1 : 2));
  // Yollar bir kez kurulur: her kol ayrı yol, ayrıca derinlik başına hepsi bir arada
  if (!D.full) {
    const full = [S.Path.Make(), S.Path.Make(), S.Path.Make()];
    for (const a of D.arms) {
      const p = S.Path.Make();
      p.moveTo(a.pts[0]![0], a.pts[0]![1]);
      full[a.d]!.moveTo(a.pts[0]![0], a.pts[0]![1]);
      for (let i = 1; i < a.pts.length; i++) {
        p.lineTo(a.pts[i]![0], a.pts[i]![1]);
        full[a.d]!.lineTo(a.pts[i]![0], a.pts[i]![1]);
      }
      a.path = p;
    }
    D.full = full;
  }
  const G = iceG(t) * D.maxB;
  if (G <= 0) return;
  g.add = true;
  const dim = v.kind === 'card' ? 0.75 : 1;
  const stroke = (p: SkPath, d: number): void => {
    g.c.drawPath(p, g.stroke('#8fdcff', ICE_A1[d]! * dim, ICE_W1[d]!));
    g.c.drawPath(p, g.stroke('#effbff', ICE_A2[d]! * dim, ICE_W2[d]!));
  };
  const tips: Pt[] = [];
  if (G >= D.maxB) {
    for (let d = 0; d < 3; d++) stroke(D.full[d]!, d);
  } else {
    // Masaüstündeki gibi derinlik sırasıyla (kalın dallar önce)
    for (let d = 0; d < 3; d++) {
      for (const a of D.arms) {
        if (a.d !== d || a.birth >= G || !a.path) continue;
        const f = (G - a.birth) / a.len;
        if (f >= 1) {
          stroke(a.path, d);
          continue;
        }
        const part = S.Path.Trim(a.path, 0, f, false);
        if (part) {
          stroke(part, d);
          part.dispose?.();
        }
        if (d === 0) tips.push(armPoint(a, f));
      }
    }
  }
  for (const p of tips) g.glow('cool', p[0], p[1], 9, 0.8 * dim);
  for (const gl of D.gl) {
    if (gl.sg.b1 > G) continue;
    const env = Math.pow(Math.max(0, Math.sin(t * gl.rate + gl.ph)), 14);
    if (env < 0.02) continue;
    g.sparkle(gl.sg.x2, gl.sg.y2, gl.L * (0.6 + 0.4 * env), env, '#ffffff', 0.15);
    g.sparkle(gl.sg.x2, gl.sg.y2, gl.L * 0.45, env * 0.7, '#bff0ff', Math.PI / 4 + 0.15);
    g.glow('cool', gl.sg.x2, gl.sg.y2, gl.L * 3, env * 0.7);
  }
  g.add = false;
}

// ---------- 6. Neon Yağmur: halkaya çarpan damlalar, cam üstünde kayan damlalar ----------

function drawNeon(g: Pen, v: LayerView, t: number): void {
  if (v.kind === 'deco') {
    const cx = v.w / 2;
    const cy = v.h / 2;
    const Rr = v.R * 1.22;
    const k = v.R / 46;
    for (let i = 0; i < 5; i++) {
      const D = 1.3 + i * 0.23;
      const u = posmod(t + i * 0.71, D) / D;
      const cyc = Math.floor((t + i * 0.71) / D);
      const dx = (hash(cyc * 13 + i * 101) - 0.5) * 1.5 * Rr * 0.85;
      const hitY = cy - Math.sqrt(Math.max(0, Rr * Rr - dx * dx));
      if (u < 0.45) {
        const q = u / 0.45;
        const y = -6 + (hitY + 6) * q * q;
        g.line(cx + dx, y - 7 * k * q - 2, cx + dx, y, g.stroke('#d8f4ff', 0.65 * smooth(0, 0.15, q), 1.1));
      } else if (u < 0.8) {
        const tau = (u - 0.45) * D;
        const fade = 1 - (u - 0.45) / 0.35;
        g.add = true;
        g.glow(dx < 0 ? 'mag' : 'cyan', cx + dx, hitY, 16 * k * (1 - fade * 0.3), fade * 0.8);
        const dot = g.fill('#e8fbff', fade * 0.9);
        for (let j = 0; j < 3; j++) {
          const vx = (j - 1) * 24 + (hash(j + cyc * 7) - 0.5) * 14;
          const vy = -26 - 18 * hash(j * 3 + cyc);
          g.circle(cx + dx + vx * k * tau, hitY + (vy * tau + 160 * tau * tau) * k, 0.9, dot);
        }
        g.add = false;
      }
    }
    const Dd = 2.6;
    const u = posmod(t, Dd) / Dd;
    const bx = cx + 6 * k;
    const by = cy + Rr;
    if (u < 0.7) {
      const r = 2.3 * k * easeOutBack(u / 0.7);
      g.ellipse(bx, by + r * 0.9, Math.max(0, r * 0.8), Math.max(0, r), 0, g.fill('#cfefff', 0.8));
    } else {
      const tau = (u - 0.7) * Dd;
      const y = by + 2 + 200 * k * tau * tau;
      g.ellipse(bx, y, 1.6 * k, 2.4 * k, 0, g.fill('#cfefff', 0.8 * (1 - (u - 0.7) / 0.3)));
    }
    return;
  }
  if (v.kind !== 'card') return;
  const list = cached(v, 'drops', () => {
    const r = rng(61);
    return Array.from({ length: 9 }, () => ({ x: 0.04 + r() * 0.92, y: r(), f: 0.25 + r() * 0.35, st: 18 + r() * 30, rad: 1.6 + r() * 1.8, ph: r() * 10 }));
  });
  const S = g.S;
  const H = v.h + 30;
  const r0 = S.Color('rgba(180,220,255,0)');
  const r1 = S.Color('rgba(180,220,255,.16)');
  for (const o of list) {
    const tt = t * o.f + o.ph;
    const step = Math.floor(tt);
    const fr = tt - step;
    const yy = posmod(o.y * H + (step + easeOutBack(clamp(fr / 0.35))) * o.st, H) - 15;
    const x = o.x * v.w + Math.sin(step * 1.7 + o.ph) * 2;
    if (Math.hypot(x - v.geo.ax, yy - v.geo.ay) < v.geo.ar + 4) continue;
    const trail = S.Shader.MakeLinearGradient(S.Point(x, yy - 40), S.Point(x, yy), [r0, r1], null, TILE_CLAMP);
    g.line(x, yy - 40, x, yy, g.shade(trail, 1, o.rad * 0.8));
    trail.dispose?.();
    g.ellipse(x, yy, o.rad, o.rad * 1.18, 0, g.fill('#bfe3ff', 0.22));
    const oval = S.XYWHRect(x - o.rad * 0.85, yy + o.rad * 0.15 - o.rad * 0.85, o.rad * 1.7, o.rad * 1.7);
    g.c.drawArc(oval, 0.3 * DEG, 1.1 * DEG, false, g.stroke('#ff5bd8', 0.75, 0.7));
    g.c.drawArc(oval, 1.7 * DEG, 1.1 * DEG, false, g.stroke('#5fe8ff', 0.75, 0.7));
    g.circle(x - o.rad * 0.35, yy - o.rad * 0.4, o.rad * 0.28, g.fill('#ffffff', 0.9));
  }
}

// ---------- Gölgelendirici derlenemezse: sade 2B zeminler ----------

export function drawFallback(g: Pen, v: LayerView, set: CosmeticSet): void {
  const S = g.S;
  const W = v.w;
  const H = v.h;
  const P = COSMETIC_SET_INFO[set].fallback;
  const rect = S.XYWHRect(0, 0, W, H);
  const radial = (x: number, y: number, r: number, stops: [number, string][]): SkShader =>
    S.Shader.MakeRadialGradient(S.Point(x, y), Math.max(0.01, r), stops.map((s) => S.Color(s[1])), stops.map((s) => s[0]), TILE_CLAMP);
  const linear = (x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): SkShader =>
    S.Shader.MakeLinearGradient(S.Point(x0, y0), S.Point(x1, y1), stops.map((s) => S.Color(s[1])), stops.map((s) => s[0]), TILE_CLAMP);
  if (set === 'karadelik') {
    const L = bhLayout(v);
    if (v.kind === 'thumb' || v.kind === 'plate') g.c.drawRect(rect, g.fill('#040308', 1));
    if (v.kind === 'card') {
      g.c.drawRect(rect, g.shade(radial(L.cx, L.cy, L.RS * 6, [[0, 'rgba(3,2,8,.95)'], [1, 'rgba(3,2,8,0)']]), 1));
    }
    const ro = v.kind === 'deco' ? W * 0.49 : L.RS * 3.6;
    const ring = S.Path.Make();
    ring.addCircle(0, 0, ro);
    ring.addCircle(0, 0, L.RS * 1.1);
    ring.setFillType(1); // çift-tek: iç çember delik
    g.c.save();
    g.c.translate(L.cx, L.cy);
    g.c.rotate(0.12 * DEG, 0, 0);
    g.c.scale(1, v.kind === 'deco' ? 0.3 : 0.2);
    // Canvas 2D'deki iki yarıçaplı degrade (iç çemberden dışa): durak konumları iç çembere göre kaydırılır
    const i0 = (L.RS * 1.1) / ro;
    const disk = radial(0, 0, ro, [
      [0, 'rgba(255,230,180,.95)'],
      [i0, 'rgba(255,230,180,.95)'],
      [i0 + 0.35 * (1 - i0), 'rgba(255,130,40,.7)'],
      [1, 'rgba(255,80,20,0)'],
    ]);
    g.c.drawPath(ring, g.shade(disk, 1));
    g.c.restore();
    if (v.kind !== 'deco') g.circle(L.cx, L.cy, L.RS, g.fill('#000', 1));
    g.circle(L.cx, L.cy, L.RS * 1.03, g.stroke('rgba(255,225,180,.9)', 1, 1.2));
    return;
  }
  if (v.kind === 'thumb' || v.kind === 'plate') {
    g.c.drawRect(rect, g.shade(linear(0, 0, W * 0.3, H, [[0, P[0]], [1, P[1]]]), 1));
    g.c.drawRect(rect, g.shade(radial(W * 0.78, H * 0.25, Math.max(W, H) * 0.6, [[0, P[2]], [1, 'rgba(0,0,0,0)']]), 1));
    if (v.kind === 'plate') g.c.drawRect(rect, g.shade(linear(0, 0, W, 0, [[0, 'rgba(0,0,0,.6)'], [0.6, 'rgba(0,0,0,0)']]), 1));
  } else if (v.kind === 'card') {
    const bh = v.geo.bh;
    g.c.drawRect(S.XYWHRect(0, 0, W, bh * 1.6), g.shade(radial(W * 0.75, bh * 0.3, bh * 1.6, [[0, P[2]], [1, 'rgba(0,0,0,0)']]), 1));
  } else {
    const R = v.R;
    const ring = S.Path.Make();
    ring.addCircle(W / 2, H / 2, W / 2);
    ring.addCircle(W / 2, H / 2, R);
    ring.setFillType(1);
    const inner = R / (W / 2);
    g.c.drawPath(ring, g.shade(radial(W / 2, H / 2, W / 2, [[0, 'rgba(0,0,0,0)'], [inner * 0.95, P[2]], [1, 'rgba(0,0,0,0)']]), 1));
  }
}

/** Setlerin 2B katmanları (gölgelendiricinin üstüne; gölgelendirici yokken yedek zeminin üstüne) */
export const LAYERS: Record<CosmeticSet, (g: Pen, v: LayerView, t: number) => void> = {
  karadelik: drawKaradelik,
  sakura: drawSakura,
  kuzey: drawAurora,
  atesbocegi: drawForest,
  buz: drawIce,
  neon: drawNeon,
};
