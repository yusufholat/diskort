// Hareketli kozmetiklerin çizim motoru. Bütün uygulama için TEK WebGL bağlamı (ekranda olmayan bir
// tuval) ve TEK requestAnimationFrame döngüsü: her görünüm (profil kartı, dekorasyon, isim plakası,
// seçici kutusu) sırayla bu bağlamda çizilir, sonuç görünümün kendi 2B tuvaline kopyalanır, üstüne setin
// 2B katmanı çizilir. Ekranda olmayan görünüm (IntersectionObserver) ve gizli pencere çizilmez; hiç görünür
// görünüm yoksa döngü durur. "Hareketi azalt" açıkken her görünüm tek bir sabit kare olarak çizilir.
// WebGL yoksa (ya da gölgelendirici derlenemezse) 2B yedek zemin kullanılır.

import type { CosmeticSet } from '@diskort/shared';
import {
  COSMETIC_SHADER_COMMON,
  COSMETIC_SHADER_MAIN,
  COSMETIC_SHADERS,
  COSMETIC_VERTEX_SHADER,
  SHADER_MODE,
  type ShaderViewKind,
} from '@diskort/client-core';
import { drawFallback, LAYERS, type CardGeo, type LayerView } from './layers';

/** Tuval çözünürlüğü en fazla 2× (4K ekranda gereksiz yük olmasın) */
const DPR_CAP = 2;
/** "Hareketi azalt" açıkken gösterilen anın zamanı (her set için dolu, güzel bir kare) */
const STATIC_T = 8.4;
/** Yüksek tazeleme hızlı ekranda (144 Hz) da en fazla bu kadar kare: gözle fark yok, yük yarı */
const MAX_FPS = 60;

export interface ViewOptions {
  kind: ShaderViewKind;
  set: CosmeticSet;
  /** Dekorasyonda avatarın yarıçapı (css px) */
  R?: number;
  /** Gölgelendiricinin çözünürlük katı (kart büyük: 0.75 yeter, 2B katman tam çözünürlükte) */
  glScale?: number;
  /** Saniyedeki en fazla kare (isim plakası, seçici kutuları 30); verilmezse 60 */
  fps?: number;
  /** Durdurulmuş: son kare sabit kalır (ör. sesli sahnede konuşmayan katılımcı) */
  paused?: boolean;
  /** Kartın ölçüleri (yalnızca kart): boyut değişince yeniden ölçülür */
  measure?: () => CardGeo | null;
}

export interface ViewHandle {
  update(options: Partial<Omit<ViewOptions, 'kind'>>): void;
  /** Kartın ölçülerini yeniden alır (ör. afiş değişti) */
  remeasure(): void;
  dispose(): void;
}

interface View extends LayerView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  set: CosmeticSet;
  visible: boolean;
  glScale: number;
  fps: number;
  paused: boolean;
  /** Son çizimin zamanı (ms) */
  last: number;
  /** Sabit kare modunda yeniden çizilmeli */
  dirty: boolean;
  measure?: () => CardGeo | null;
  /** Tam ekran bir pencerenin (ayarlar) altında kalıyor: çizilmez */
  covered: boolean;
  /** covered en son hangi örtü sürümüne göre hesaplandı */
  coverVersion: number;
}

interface Program {
  p: WebGLProgram;
  off: WebGLUniformLocation | null;
  res: WebGLUniformLocation | null;
  k: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  mode: WebGLUniformLocation | null;
  a: WebGLUniformLocation | null;
}

const views = new Set<View>();
let T = 0;
let raf = 0;
let last = 0;

// ---------- Hareketi azalt ----------

const reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = reducedQuery?.matches ?? false;
reducedQuery?.addEventListener('change', (e) => {
  reduced = e.matches;
  for (const v of views) v.dirty = true;
  kick();
});

// ---------- Paylaşılan WebGL bağlamı ----------

let glc: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let glLost = false;
let buf: WebGLBuffer | null = null;
let precision = 'highp';
/** Atlasın en fazla genişliği (GL piksel) */
let atlasMax = 4096;
let programs = new Map<CosmeticSet, Program | null>();

function glSetup(): void {
  if (!gl) return;
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  precision = hp && hp.precision > 0 ? 'highp' : 'mediump';
  buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  atlasMax = Math.min(4096, (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0] ?? 4096);
  programs = new Map();
}

/** Bağlam ilk görünümde kurulur (hiç kozmetik görmeyen kullanıcıda hiç açılmaz) */
function ensureGl(): WebGLRenderingContext | null {
  if (glc) return gl;
  glc = document.createElement('canvas');
  glc.width = glc.height = 64;
  try {
    gl = glc.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Kopya çizimle aynı görevde alınır: tamponun korunmasına gerek yok
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
  } catch {
    gl = null;
  }
  if (!gl) console.warn('[kozmetik] WebGL kullanılamıyor, 2B çizime geçiliyor');
  glSetup();
  glc.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glLost = true;
  });
  glc.addEventListener('webglcontextrestored', () => {
    glLost = false;
    glSetup();
    for (const v of views) v.dirty = true;
    kick();
  });
  return gl;
}

function program(set: CosmeticSet): Program | null {
  if (!gl) return null;
  const known = programs.get(set);
  if (known !== undefined) return known;
  programs.set(set, null);
  const g = gl;
  const shader = (type: number, src: string): WebGLShader | null => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      console.warn(`[kozmetik:${set}] gölgelendirici derlenemedi, 2B çizime geçiliyor:`, g.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = shader(g.VERTEX_SHADER, COSMETIC_VERTEX_SHADER);
  const fs = shader(
    g.FRAGMENT_SHADER,
    `precision ${precision} float;\n${COSMETIC_SHADER_COMMON}${COSMETIC_SHADERS[set]}${COSMETIC_SHADER_MAIN}`,
  );
  if (!vs || !fs) return null;
  const p = g.createProgram();
  if (!p) return null;
  g.attachShader(p, vs);
  g.attachShader(p, fs);
  g.bindAttribLocation(p, 0, 'a');
  g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) {
    console.warn(`[kozmetik:${set}] bağlanamadı:`, g.getProgramInfoLog(p));
    return null;
  }
  const u = (n: string): WebGLUniformLocation | null => g.getUniformLocation(p, n);
  const prog: Program = { p, off: u('u_off'), res: u('u_res'), k: u('u_k'), time: u('u_time'), mode: u('u_mode'), a: u('u_a') };
  programs.set(set, prog);
  return prog;
}

// ---------- Gözlemciler ----------

const viewOf = new WeakMap<Element, View>();

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const v = viewOf.get(e.target);
      if (!v) continue;
      v.visible = e.isIntersecting;
      if (v.visible) v.dirty = true;
    }
    kick();
  },
  { rootMargin: '40px' },
);

const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const v = viewOf.get(e.target);
    if (!v) continue;
    v.w = e.contentRect.width;
    v.h = e.contentRect.height;
    v.cache.clear();
    if (v.measure) v.geo = v.measure() ?? v.geo;
    v.dirty = true;
  }
  kick();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  } else kick();
});

// ---------- Çizim ----------

/** Bu karede çizilecek görünümün GL bölgesi (atlasta) */
interface Slot {
  v: View;
  P: Program | null;
  k: number;
  x: number;
  y: number;
  pw: number;
  ph: number;
}

/** Görünümün tuvalini boyutlar ve 2B bağlamını hazırlar; çizilemiyorsa null */
function prepare(v: View): CanvasRenderingContext2D | null {
  if (v.w < 2 || v.h < 2) return null;
  const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  v.dpr = dpr;
  const cw = Math.round(v.w * dpr);
  const ch = Math.round(v.h * dpr);
  if (v.canvas.width !== cw || v.canvas.height !== ch) {
    v.canvas.width = cw;
    v.canvas.height = ch;
  }
  // 2B bağlam ilk çizimde alınır: hiç ekrana gelmeyen satırın tuvali bellek tutmaz
  v.ctx ??= v.canvas.getContext('2d');
  return v.ctx;
}

/**
 * Karedeki bütün görünümler iki adımda çizilir: önce hepsinin gölgelendiricisi paylaşılan GL tuvalinin
 * ayrı bölgelerine (raf raf yerleşen bir atlas), sonra her görünüm kendi bölgesini 2B tuvaline kopyalar ve
 * 2B katmanını çizer. Böylece GL tuvalinin kopyası karede bir kez alınır (görünüm başına değil).
 */
function renderAll(list: View[], t: number): void {
  const g = ensureGl();
  const slots: Slot[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  const maxW = atlasMax;
  for (const v of list) {
    if (!prepare(v)) continue;
    const P = g && !glLost ? program(v.set) : null;
    const k = v.dpr * v.glScale;
    const pw = Math.max(1, Math.round(v.w * k));
    const ph = Math.max(1, Math.round(v.h * k));
    if (P) {
      if (x > 0 && x + pw > maxW) {
        x = 0;
        y += row;
        row = 0;
      }
      slots.push({ v, P, k, x, y, pw, ph });
      x += pw;
      row = Math.max(row, ph);
      width = Math.max(width, x);
    } else slots.push({ v, P: null, k, x: 0, y: 0, pw, ph });
  }
  const height = y + row;
  if (g && glc && width > 0) {
    // Tuval yalnızca büyür (her karede yeniden boyutlanmasın)
    if (glc.width < width || glc.height < height) {
      glc.width = Math.max(glc.width, width);
      glc.height = Math.max(glc.height, height);
    }
    g.viewport(0, 0, glc.width, glc.height);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    for (const s of slots) {
      if (!s.P) continue;
      const v = s.v;
      // GL'in başlangıcı sol alt: bölgenin tuvaldeki yeri yukarıdan s.y
      const oy = glc.height - s.y - s.ph;
      g.viewport(s.x, oy, s.pw, s.ph);
      g.useProgram(s.P.p);
      g.uniform2f(s.P.off, s.x, oy);
      g.uniform2f(s.P.res, v.w, v.h);
      g.uniform1f(s.P.k, s.k);
      g.uniform1f(s.P.time, t);
      g.uniform1f(s.P.mode, SHADER_MODE[v.kind]);
      if (v.kind === 'card') g.uniform4f(s.P.a, v.geo.bh, v.geo.ax, v.geo.ay, v.geo.ar);
      else g.uniform4f(s.P.a, v.R, 0, 0, 0);
      g.drawArrays(g.TRIANGLES, 0, 3);
    }
  }
  for (const s of slots) {
    const v = s.v;
    const ctx = v.ctx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
    if (s.P && glc) ctx.drawImage(glc, s.x, s.y, s.pw, s.ph, 0, 0, v.canvas.width, v.canvas.height);
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    if (!s.P) drawFallback(ctx, v, v.set);
    LAYERS[v.set](ctx, v, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function frame(now: number): void {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (reduced) T = STATIC_T;
  else T += dt;
  let running = false;
  const due: View[] = [];
  for (const v of views) {
    if (!v.visible || isCovered(v)) continue;
    // Hareketi azalt açıkken ya da durdurulmuş görünümde yalnızca değişince tek kare çizilir
    if (reduced || v.paused) {
      if (v.dirty) due.push(v);
      v.dirty = false;
      continue;
    }
    running = true;
    // Kare sınırı: bir sonraki çizime kalan süre yarım kareden azsa şimdi çizilir
    if (v.fps > 0 && !v.dirty && now - v.last < 1000 / v.fps - 8) continue;
    due.push(v);
    v.last = now;
    v.dirty = false;
  }
  if (due.length > 0) renderAll(due, T);
  if (running && !document.hidden) raf = requestAnimationFrame(frame);
  else last = 0;
}

// ---------- Örtüler ----------

/**
 * Tam ekran pencereler (Ayarlar, Sunucu Ayarları) açıkken altlarında kalan görünümler (üye listesi
 * plakaları, profil kartı) ekranda görünmese de IntersectionObserver'a göre görünürdür: pencere kendini
 * örtü olarak bildirir, içinde olmayan görünümler çizilmez.
 */
const covers = new Set<Element>();
let coverVersion = 0;

function isCovered(v: View): boolean {
  if (v.coverVersion !== coverVersion) {
    v.coverVersion = coverVersion;
    v.covered = false;
    if (covers.size > 0) {
      v.covered = true;
      for (const c of covers) if (c.contains(v.canvas)) v.covered = false;
    }
  }
  return v.covered;
}

/** Tam ekran pencere açıldı (el) ya da kapandı: altındaki görünümler durur / yeniden çizilir */
export function setCosmeticsCover(el: Element, on: boolean): void {
  if (on) covers.add(el);
  else covers.delete(el);
  coverVersion++;
  for (const v of views) v.dirty = true;
  kick();
}

function kick(): void {
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
}

/** Tuvali motora bağlar; dönen tutamaçla ayarları değiştirilir, bileşen kalkınca bırakılır. */
export function attachView(canvas: HTMLCanvasElement, options: ViewOptions): ViewHandle {
  const v: View = {
    canvas,
    ctx: null,
    kind: options.kind,
    set: options.set,
    visible: false,
    w: canvas.clientWidth,
    h: canvas.clientHeight,
    dpr: 1,
    cache: new Map(),
    geo: { bh: 106, ax: 62, ay: 112, ar: 46 },
    R: options.R ?? 46,
    glScale: options.glScale ?? 1,
    fps: options.fps ?? MAX_FPS,
    paused: options.paused ?? false,
    last: 0,
    dirty: true,
    measure: options.measure,
    covered: false,
    coverVersion: -1,
  };
  if (v.measure) v.geo = v.measure() ?? v.geo;
  viewOf.set(canvas, v);
  views.add(v);
  io.observe(canvas);
  ro.observe(canvas);
  return {
    update(next) {
      if (next.set !== undefined && next.set !== v.set) {
        v.set = next.set;
        v.cache.clear();
      }
      if (next.R !== undefined && next.R !== v.R) {
        v.R = next.R;
        v.cache.clear();
      }
      if (next.glScale !== undefined) v.glScale = next.glScale;
      v.fps = next.fps ?? v.fps;
      v.paused = next.paused ?? v.paused;
      if (next.measure !== undefined) v.measure = next.measure;
      v.dirty = true;
      kick();
    },
    remeasure() {
      if (v.measure) v.geo = v.measure() ?? v.geo;
      // Katmanların hazır listeleri kartın ölçülerine göre kurulur
      v.cache.clear();
      v.dirty = true;
      kick();
    },
    dispose() {
      io.unobserve(canvas);
      ro.unobserve(canvas);
      viewOf.delete(canvas);
      views.delete(v);
    },
  };
}

/** Geliştirme ve ölçüm için: kaç görünüm var, kaçı görünür (türlerine göre), WebGL mi */
export function cosmeticsStats(): { views: number; visible: Record<string, number>; webgl: boolean; reduced: boolean } {
  const visible: Record<string, number> = {};
  for (const v of views) if (v.visible && !isCovered(v)) visible[v.kind] = (visible[v.kind] ?? 0) + 1;
  return { views: views.size, visible, webgl: Boolean(gl) && !glLost, reduced };
}

if (import.meta.env.DEV) (window as unknown as { __cosmetics: unknown }).__cosmetics = cosmeticsStats;
