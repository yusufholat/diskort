// Gürültü engelleme motorları (DeepFilterNet 3, DPDFNet) ve ortak ölçüm/ısınma kodu. İki barındırıcıda da
// aynen çalışır: gerçek zamanlı hesap worklet'i (compute.worklet.ts, birincil) ve Web Worker
// (denoise.worker.ts, yedek). İkisi de köprüyle (bridge-worklet.js) aynı paylaşımlı halkalar üzerinden konuşur.
import * as ort from 'onnxruntime-web/wasm';
import { DeepFilterEngine } from '../deepfilter/dfn-engine.js';
import { DpdfnetDenoiser, readOnnxMetadata } from '../dpdfnet/dsp.js';
import { HOP } from './ring';

export type EngineInit =
  | {
      kind: 'deepfilter';
      attenLimDb: number;
      wasmModule: WebAssembly.Module;
      model: ArrayBuffer;
      postFilterBeta: number;
    }
  | {
      kind: 'dpdfnet';
      attenLimDb: number;
      ortWasm: ArrayBuffer;
      model: ArrayBuffer;
    };

export interface Engine {
  /** Bir kareyi (480 örnek) işler; DeepFilterNet eşzamanlı, DPDFNet (onnxruntime) Promise döndürür. */
  process(hop: Float32Array, out: Float32Array): unknown;
  setAttenLimit(db: number): void;
}

/** İşlenen kare sürelerinin 2 saniyelik özeti (bkz. MicProcessingStats) */
export interface FrameStats {
  load: number;
  frames: number;
  avgFrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  over2ms: number;
  overQuantum: number;
  overHop: number;
}

/** Barındırıcının ana tarafa 2 saniyede bir gönderdiği ölçümler (halka sayaçlarıyla birlikte) */
export interface HostStats extends FrameStats {
  type: 'stats';
  /** Başından beri: köprünün çıkış tamponu boşaldı (duyulabilir kısa boşluk) */
  underruns: number;
  /** Başından beri atılan örnekler (barındırıcı takıldı) */
  droppedSamples: number;
  /** Köprünün şu anki tamponu (ms) */
  bufferMs: number;
}

export type HostMessage =
  | { type: 'ready'; warmupFrameMs: number }
  | { type: 'error'; message: string }
  | HostStats;

export const REPORT_INTERVAL_MS = 2000;
const QUANTUM_MS = (128 / 48000) * 1000;
const WARMUP_FRAMES = 40;

/** Modeli kurar; her çağrıda temiz durumlu yeni bir motor döndüren fabrika verir. */
export async function createEngineFactory(init: EngineInit): Promise<() => Engine> {
  if (init.kind === 'deepfilter') {
    const model = new Uint8Array(init.model);
    return () => {
      const e = new DeepFilterEngine(init.wasmModule, model, init.attenLimDb, init.postFilterBeta);
      return { process: (hop, out) => e.processHop(hop, out), setAttenLimit: (db) => e.setAttenLimit(db) };
    };
  }
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = init.ortWasm;
  const meta = readOnnxMetadata(init.model);
  const session = await ort.InferenceSession.create(new Uint8Array(init.model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return () => {
    const d = new DpdfnetDenoiser(ort, session, meta, init.attenLimDb);
    return { process: (hop, out) => d.processHop(hop, out), setAttenLimit: (db) => d.setAttenLimit(db) };
  };
}

/**
 * Isınma: wasm/JIT ilk karelerde yavaştır; canlı sesten önce çalıştırıp kare başına süreyi ölçer
 * (işlemci yetersizse hiç başlatılmaz). Ölçüm son yarıdaki karelerin ortalamasıdır.
 */
export async function warmUp(engine: Engine, now: () => number): Promise<number> {
  const hop = new Float32Array(HOP);
  const out = new Float32Array(HOP);
  let seed = 1;
  let ms = 0;
  for (let f = 0; f < WARMUP_FRAMES; f++) {
    for (let i = 0; i < HOP; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      hop[i] = (seed / 4294967296 - 0.5) * 1e-3;
    }
    const s = now();
    await engine.process(hop, out);
    if (f >= WARMUP_FRAMES / 2) ms += now() - s;
  }
  return ms / (WARMUP_FRAMES / 2);
}

/** Kare sürelerini toplar; bellek ayırmadan (sabit dizi) 2 saniyelik özet çıkarır. */
export class FrameTimer {
  private times = new Float64Array(1024);
  private n = 0;
  private busy = 0;
  private since: number;

  constructor(private readonly now: () => number) {
    this.since = now();
  }

  add(ms: number): void {
    if (this.n < this.times.length) this.times[this.n] = ms;
    this.n++;
    this.busy += ms;
  }

  /** Aralık dolduysa özeti döndürüp sıfırlar, dolmadıysa null. */
  take(): FrameStats | null {
    const t = this.now();
    if (t - this.since < REPORT_INTERVAL_MS) return null;
    const count = Math.min(this.n, this.times.length);
    const sorted = this.times.subarray(0, count).slice().sort();
    let over2ms = 0;
    let overQuantum = 0;
    let overHop = 0;
    for (let i = 0; i < count; i++) {
      const v = sorted[i]!;
      if (v > 2) over2ms++;
      if (v > QUANTUM_MS) overQuantum++;
      if (v > 10) overHop++;
    }
    const stats: FrameStats = {
      load: this.busy / (t - this.since),
      frames: this.n,
      avgFrameMs: this.n ? this.busy / this.n : 0,
      p99FrameMs: count ? sorted[Math.min(count - 1, Math.floor(count * 0.99))]! : 0,
      maxFrameMs: count ? sorted[count - 1]! : 0,
      over2ms,
      overQuantum,
      overHop,
    };
    this.n = 0;
    this.busy = 0;
    this.since = t;
    return stats;
  }
}
