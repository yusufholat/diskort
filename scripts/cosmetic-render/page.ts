// Çizim aracının tarayıcı tarafı (gizli Electron penceresinde çalışır). Bir parçayı (dekorasyon, plaka, kart)
// kare kare, AÇIK zaman değeriyle çizer: duvar saati ve requestAnimationFrame yok. Birleştirme masaüstü
// motorundaki (apps/desktop .../cosmetics/engine.ts renderAll) adımların aynısıdır: gölgelendirici WebGL
// tuvaline (önceden alfayla çarpılmış), oradan görünümün 2B tuvaline kopyalanır, üstüne setin gerçek 2B
// katmanı (layers.ts) ve plakada perde çizilir. Kare getImageData ile okunur: düz (çarpılmamış) RGBA.

import { drawPlateScrim, LAYERS, type CardGeo, type LayerView } from '../../apps/desktop/src/renderer/src/components/cosmetics/layers';
import {
  COSMETIC_LOOP_SHADERS,
  COSMETIC_SHADER_COMMON,
  COSMETIC_SHADERS,
  COSMETIC_VERTEX_SHADER,
  cosmeticShaderMain,
  SHADER_MODE,
  type CosmeticDither,
} from '../../packages/client-core/src/cosmeticShaders';

type CosmeticSet = keyof typeof COSMETIC_SHADERS;

/** Bir çizim işi: tek parça, art arda `frames` kare, tek ham dosyaya */
export interface RenderJob {
  set: CosmeticSet;
  kind: 'deco' | 'plate' | 'card' | 'thumb';
  /** Görünümün boyutu (css px) */
  w: number;
  h: number;
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

// Pencere yalnızca bu aracın kendi dosyasını yükler: düğüm modülleri açık (kareler doğrudan diske yazılır)
const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
const fs = nodeRequire('node:fs') as typeof import('node:fs');

function compile(gl: WebGLRenderingContext, job: RenderJob): WebGLProgram {
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const precision = hp && hp.precision > 0 ? 'highp' : 'mediump';
  const effect = job.loop === null ? COSMETIC_SHADERS[job.set] : COSMETIC_LOOP_SHADERS[job.set]?.(job.loop);
  if (!effect) throw new Error(`"${job.set}" setinin döngü biçimi yok (client-core cosmeticShaders COSMETIC_LOOP_SHADERS)`);
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type);
    if (!s) throw new Error('gölgelendirici oluşturulamadı');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`gölgelendirici derlenemedi: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  if (!p) throw new Error('program oluşturulamadı');
  gl.attachShader(p, shader(gl.VERTEX_SHADER, COSMETIC_VERTEX_SHADER));
  gl.attachShader(
    p,
    shader(gl.FRAGMENT_SHADER, `precision ${precision} float;\n${COSMETIC_SHADER_COMMON}${effect}${cosmeticShaderMain(job.dither)}`),
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
    h: job.h,
    dpr: job.dpr,
    cache: new Map(),
    geo: job.geo ?? { bh: 106, ax: 62, ay: 112, ar: 46 },
    R: job.R ?? 46,
    loop: job.loop ?? undefined,
  };
  const k = v.dpr * job.glScale;
  const pw = Math.max(1, Math.round(v.w * k));
  const ph = Math.max(1, Math.round(v.h * k));
  glc.width = pw;
  glc.height = ph;

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
  canvas.height = Math.round(v.h * v.dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2B bağlam alınamadı');

  const fd = fs.openSync(job.out, 'w');
  try {
    for (let i = 0; i < job.times.length; i++) {
      const t = job.times[i]!;
      if (gl.isContextLost()) throw new Error('WebGL bağlamı kayboldu');
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uni.off, 0, 0);
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

(window as unknown as { cosmeticRender: typeof run }).cosmeticRender = run;
