// DPDFNet gürültü engelleyicisinin çalıştığı ayrı iş parçacığı (Web Worker).
//
// Model, DeepFilterNet'ten ~3 kat ağır olduğundan ses iş parçacığında (AudioWorklet) değil burada çalışır:
// worklet her 10 ms'lik (480 örnek) kareyi MessagePort ile buraya yollar, sonuç aynı yoldan döner. Böylece
// yavaş bir kare ses iş parçacığının 2,67 ms'lik süresini aşıp cızırtı yapmaz; worklet'teki tampon (~10 ms)
// kare başına 10 ms'ye kadar işleme süresini sessizce karşılar.
//
// Çıkarım: onnxruntime-web (wasm SIMD, tek iş parçacığı). Tamponlar gidip gelirken aktarılır (kopya yok).
import * as ort from 'onnxruntime-web/wasm';
import { DpdfnetDenoiser, HOP, readOnnxMetadata } from './dsp.js';

export interface DpdfnetWorkerInit {
  type: 'init';
  wasm: ArrayBuffer;
  model: ArrayBuffer;
  attenLimDb: number;
  /** Worklet ile doğrudan konuşulan kanal */
  port: MessagePort;
}

export interface DpdfnetWorkerStats {
  type: 'stats';
  /** İşleme süresi / gerçek süre (tek çekirdek oranı) */
  load: number;
  frames: number;
  avgFrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  /** Aralıkta 2 ms'yi aşan kareler */
  over2ms: number;
  /** Aralıkta 2,67 ms'yi (bir ses bloğu) aşan kareler; burada ses iş parçacığını bekletmez */
  overQuantum: number;
  /** Aralıkta 10 ms'yi (kare süresi) aşan kareler; tampon yetmezse boşluk olur */
  overHop: number;
}

export type DpdfnetWorkerMessage =
  | { type: 'ready'; initMs: number; warmupFrameMs: number }
  | { type: 'error'; message: string }
  | DpdfnetWorkerStats;

const REPORT_INTERVAL_MS = 2000;
const WARMUP_FRAMES = 40;
const QUANTUM_MS = (128 / 48000) * 1000;

let denoiser: DpdfnetDenoiser | null = null;
let chain: Promise<void> = Promise.resolve();
let failed = false;

const times: number[] = [];
let busyMs = 0;
let lastReport = 0;

function post(msg: DpdfnetWorkerMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

function report(): void {
  const now = performance.now();
  if (now - lastReport < REPORT_INTERVAL_MS) return;
  const sorted = times.slice().sort((a, b) => a - b);
  const n = sorted.length;
  post({
    type: 'stats',
    load: busyMs / (now - lastReport),
    frames: n,
    avgFrameMs: n ? busyMs / n : 0,
    p99FrameMs: n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))]! : 0,
    maxFrameMs: n ? sorted[n - 1]! : 0,
    over2ms: sorted.filter((t) => t > 2).length,
    overQuantum: sorted.filter((t) => t > QUANTUM_MS).length,
    overHop: sorted.filter((t) => t > 10).length,
  });
  times.length = 0;
  busyMs = 0;
  lastReport = now;
}

async function init(msg: DpdfnetWorkerInit): Promise<void> {
  const t0 = performance.now();
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = msg.wasm;
  const meta = readOnnxMetadata(msg.model);
  const session = await ort.InferenceSession.create(new Uint8Array(msg.model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  // Isınma: wasm ve JIT ilk karelerde yavaştır; canlı sesten önce çalıştırıp işlemci hızını da ölç.
  const warm = new DpdfnetDenoiser(ort, session, meta, msg.attenLimDb);
  const hop = new Float32Array(HOP);
  let seed = 1;
  let warmMs = 0;
  for (let f = 0; f < WARMUP_FRAMES; f++) {
    for (let i = 0; i < HOP; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      hop[i] = (seed / 4294967296 - 0.5) * 1e-3;
    }
    const s = performance.now();
    await warm.processHop(hop);
    if (f >= WARMUP_FRAMES / 2) warmMs += performance.now() - s;
  }
  // Canlı ses temiz durumla başlar
  denoiser = new DpdfnetDenoiser(ort, session, meta, msg.attenLimDb);

  const port = msg.port;
  port.onmessage = (e: MessageEvent<Float32Array>) => {
    const buf = e.data;
    chain = chain.then(async () => {
      if (failed || !denoiser) return;
      try {
        const s = performance.now();
        // Giriş önce içeri kopyalanır; aynı tampon çıkış olarak kullanılıp worklet'e geri aktarılır.
        await denoiser.processHop(buf, buf);
        const dt = performance.now() - s;
        times.push(dt);
        busyMs += dt;
        port.postMessage(buf, [buf.buffer]);
        report();
      } catch (err) {
        failed = true;
        post({ type: 'error', message: `DPDFNet karesi işlenemedi: ${String((err as Error)?.message ?? err)}` });
      }
    });
  };
  lastReport = performance.now();
  post({ type: 'ready', initMs: Math.round(performance.now() - t0), warmupFrameMs: warmMs / (WARMUP_FRAMES / 2) });
}

self.onmessage = (e: MessageEvent<DpdfnetWorkerInit | { type: 'atten'; db: number }>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => {
      failed = true;
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    });
  } else if (msg.type === 'atten') {
    denoiser?.setAttenLimit(msg.db);
  }
};
