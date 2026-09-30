// Çizim aracının tarayıcı tarafı (gizli Electron penceresinde çalışır). Bir parçayı (dekorasyon, plaka, kart)
// kare kare, AÇIK zaman değeriyle çizer: duvar saati ve requestAnimationFrame yok. Birleştirme masaüstü
// motorundaki (apps/desktop .../cosmetics/engine.ts renderAll) adımların aynısıdır: gölgelendirici WebGL
// tuvaline (önceden alfayla çarpılmış), oradan görünümün 2B tuvaline kopyalanır, üstüne setin gerçek 2B
// katmanı (layers.ts) ve plakada perde çizilir. Kare getImageData ile okunur: düz (çarpılmamış) RGBA.

import { drawPlateScrim, LAYERS, type CardGeo, type LayerView } from '../../apps/desktop/src/renderer/src/components/cosmetics/layers';
import { COSMETIC_SHADER_COMMON, COSMETIC_SHADERS, COSMETIC_VERTEX_SHADER, SHADER_MODE } from '../../packages/client-core/src/cosmeticShaders';
import { COSMETIC_SET_LABELS } from '../../packages/shared/src/index';
import { COSMETIC_LOOP_SHADERS, cosmeticShaderCommon, cosmeticShaderMain, type CosmeticDither } from '../../packages/client-core/src/cosmeticLoops';

type CosmeticSet = keyof typeof COSMETIC_SHADERS;

/** Bir çizim işi: tek parça, art arda `frames` kare, tek ham dosyaya */
export interface RenderJob {
  set: CosmeticSet;
  kind: 'deco' | 'plate' | 'card' | 'thumb';
  /** Çizilen tuvalin boyutu (css px) */
  w: number;
  h: number;
  /**
   * Efektin yerleşim yüksekliği (css px), tuvalden uzunsa: gölgelendirici ve 2B katman bu yükseklikte bir
   * görünüm çiziyormuş gibi çalışır, tuval onun ÜST kısmını gösterir (standart kart tuvali: alt kenarın
   * kırağısı tuvalin dışında kalır). Verilmezse tuvalin yüksekliği.
   */
  layoutH?: number;
  /** Alttaki yumuşak bitiş: `from`'dan `to`'ya (css px, yukarıdan) saydama iner */
  fade?: { from: number; to: number };
  /** css pikseli başına tuval pikseli (uygulamada en fazla 2) */
  dpr: number;
  /** Gölgelendiricinin çözünürlük katı (kartta 0.75, bkz. Cosmetics.tsx CardEffectCanvas) */
  glScale: number;
  /** Dekorasyonda avatarın dış yarıçapı */
  R?: number;
  /** Kartın ölçüleri */
  geo?: CardGeo;
  /** Döngü süresi (sn); null: canlı biçim (uygulamadaki zamanlama, karşılaştırma kareleri için) */
  loop: number | null;
  dither: CosmeticDither;
  /**
   * Döngü gölgelendiricisinin sete özgü seçenekleri (ör. neon: { flicker: false }): kesintisizlik denetimi,
   * bilerek konmuş ani olaylar kapalıyken de çizebilsin diye (sets/<set>.mjs continuity.shaderOptions)
   */
  shaderOptions?: Record<string, unknown>;
  /** Karelerin zamanları (sn) */
  times: number[];
  /** Ham çıktı: kareler art arda, düz RGBA, her biri (w*dpr)×(h*dpr) */
  out: string;
}

export interface RenderResult {
  width: number;
  height: number;
  frames: number;
  /** WebGL sürücüsü (bilgi için) */
  renderer: string;
  ms: number;
}

/**
 * 2B katmanı YAZILIMLA çizilen setler (döngü biçiminde). Hızlandırılmış tuval küçük yolların (çiçek, yaprak)
 * maskesini önbelleğe alıp yakın konumlarda yeniden kullanır: çok yavaş kayan bir şekil düzgün kaymak yerine
 * arada bir çeyrek piksel sıçrar, üstelik ne zaman sıçrayacağı önceki karelere bağlıdır (dikişte fazladan fark).
 * Yazılım tuvalinde her kare kendi konumunda çizilir (sakura dekorasyonunda dikiş farkı 0.76'dan 0.55'e indi).
 */
const SOFTWARE_2D: ReadonlySet<string> = new Set(['sakura']);

/**
 * Dekorasyonun kenar maskesi (karenin kısa kenarının katı olarak yarıçaplar): içte tam, dışta sıfır, arası
 * yumuşak basamak. Gölgelendiricinin kendi maskesi .43 → .50 (common.ts); bu .42 → .485: 132 css px'lik karede
 * kenardan 2 css px (4 piksel) tam saydam.
 */
const DECO_EDGE = { from: 0.42, to: 0.485 };

// Pencere yalnızca bu aracın kendi dosyasını yükler: düğüm modülleri açık (kareler doğrudan diske yazılır)
const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
const fs = nodeRequire('node:fs') as typeof import('node:fs');

function compile(gl: WebGLRenderingContext, job: RenderJob): WebGLProgram {
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const precision = hp && hp.precision > 0 ? 'highp' : 'mediump';
  // Döngü biçiminin üreticisi ikinci bir parametre (sete özgü seçenekler) alabilir
  const make = COSMETIC_LOOP_SHADERS[job.set] as ((period: number, options?: Record<string, unknown>) => string) | undefined;
  const effect = job.loop === null ? COSMETIC_SHADERS[job.set] : make?.(job.loop, job.shaderOptions);
  if (!effect) throw new Error(`"${job.set}" setinin döngü biçimi yok (client-core cosmeticLoops COSMETIC_LOOP_SHADERS)`);
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type);
    if (!s) throw new Error('gölgelendirici oluşturulamadı');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`gölgelendirici derlenemedi: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  // Ortak kısım: döngü biçiminde yıldız parıltısı da döngüye sığar (yalnızca yıldız kullanan setleri etkiler)
  const common = job.loop === null ? COSMETIC_SHADER_COMMON : cosmeticShaderCommon(job.loop);
  const p = gl.createProgram();
  if (!p) throw new Error('program oluşturulamadı');
  gl.attachShader(p, shader(gl.VERTEX_SHADER, COSMETIC_VERTEX_SHADER));
  gl.attachShader(
    p,
    shader(gl.FRAGMENT_SHADER, `precision ${precision} float;\n${common}${effect}${cosmeticShaderMain(job.dither)}`),
  );
  gl.bindAttribLocation(p, 0, 'a');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program bağlanamadı: ${gl.getProgramInfoLog(p)}`);
  return p;
}

async function run(job: RenderJob): Promise<RenderResult> {
  const started = performance.now();
  // Motordaki bağlam ayarlarının aynısı
  const glc = document.createElement('canvas');
  const gl = glc.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL kullanılamıyor');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

  const v: LayerView = {
    kind: job.kind,
    w: job.w,
    h: job.layoutH ?? job.h,
    dpr: job.dpr,
    cache: new Map(),
    geo: job.geo ?? { bh: 106, ax: 62, ay: 112, ar: 46 },
    R: job.R ?? 46,
    loop: job.loop ?? undefined,
  };
  const k = v.dpr * job.glScale;
  const pw = Math.max(1, Math.round(v.w * k));
  const ph = Math.max(1, Math.round(job.h * k));
  glc.width = pw;
  glc.height = ph;
  // Tuval, yerleşimin üst kısmı: gölgelendiricinin gördüğü GL başlangıcı (sol alt) tuvalin altında kalır
  const offY = ph - v.h * k;

  const p = compile(gl, job);
  const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n);
  const uni = { off: u('u_off'), res: u('u_res'), k: u('u_k'), time: u('u_time'), mode: u('u_mode'), a: u('u_a') };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(p);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(v.w * v.dpr);
  canvas.height = Math.round(job.h * v.dpr);
  const ctx = canvas.getContext('2d', { willReadFrequently: job.loop !== null && SOFTWARE_2D.has(job.set) });
  if (!ctx) throw new Error('2B bağlam alınamadı');
  // Alttaki bitiş: yumuşak basamak eğrisiyle (keskin başlangıç ve son yok) saydama inen maske
  let fade: CanvasGradient | null = null;
  if (job.fade) {
    fade = ctx.createLinearGradient(0, job.fade.from, 0, job.fade.to);
    for (let i = 0; i <= 16; i++) {
      const x = i / 16;
      fade.addColorStop(x, `rgba(0,0,0,${(1 - x * x * (3 - 2 * x)).toFixed(4)})`);
    }
  }

  // Dekorasyonun kare kenarı: gölgelendirici kendi katmanını daire biçiminde söndürüyor, ama 2B katmanın
  // parçaları (buz dalları, damlalar, yıldızlar…) karenin dışına taşıp kenarda düz bir çizgiyle kesiliyordu.
  // Döngü biçiminde birleşmiş karenin tamamı aynı daire maskesiyle söndürülür; maske gölgelendiricininkinden
  // biraz içeride biter ki kenardan birkaç piksellik şerit tam saydam kalsın (alfa 0).
  let edge: CanvasGradient | null = null;
  if (job.kind === 'deco' && job.loop !== null) {
    const cx = job.w / 2;
    const cy = job.h / 2;
    const m = Math.min(job.w, job.h);
    edge = ctx.createRadialGradient(cx, cy, m * DECO_EDGE.from, cx, cy, m * DECO_EDGE.to);
    for (let i = 0; i <= 16; i++) {
      const x = i / 16;
      edge.addColorStop(x, `rgba(0,0,0,${(1 - x * x * (3 - 2 * x)).toFixed(4)})`);
    }
  }

  const fd = fs.openSync(job.out, 'w');
  try {
    for (let i = 0; i < job.times.length; i++) {
      const t = job.times[i]!;
      if (gl.isContextLost()) throw new Error('WebGL bağlamı kayboldu');
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uni.off, 0, offY);
      gl.uniform2f(uni.res, v.w, v.h);
      gl.uniform1f(uni.k, k);
      gl.uniform1f(uni.time, t);
      gl.uniform1f(uni.mode, SHADER_MODE[v.kind]);
      if (v.kind === 'card') gl.uniform4f(uni.a, v.geo.bh, v.geo.ax, v.geo.ay, v.geo.ar);
      else gl.uniform4f(uni.a, v.R, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // GL tuvalinin kopyası aynı görevde alınır (tampon korunmuyor)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(glc, 0, 0, pw, ph, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      LAYERS[job.set](ctx, v, t);
      if (v.kind === 'plate') {
        ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        drawPlateScrim(ctx, v, job.set);
      }
      for (const mask of [fade, edge]) {
        if (!mask) continue;
        ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = mask;
        ctx.fillRect(0, 0, job.w, job.h);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      fs.writeSync(fd, new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength));
      // Arada bir olay döngüsüne dön: uzun işte pencere yanıtsız sayılmasın
      if (i % 30 === 29) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    fs.closeSync(fd);
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { width: canvas.width, height: canvas.height, frames: job.times.length, renderer, ms: Math.round(performance.now() - started) };
}

// Aracın Node tarafı için bilgiler: döngü biçimi olan setler ve setlerin görünen adları (paket bilgisi)
const api = window as unknown as { cosmeticRender: typeof run; cosmeticInfo: { loopSets: string[]; labels: Record<string, string> } };
api.cosmeticRender = run;
api.cosmeticInfo = { loopSets: Object.keys(COSMETIC_LOOP_SHADERS), labels: COSMETIC_SET_LABELS };
