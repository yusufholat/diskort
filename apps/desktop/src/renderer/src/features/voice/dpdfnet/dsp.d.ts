// dsp.js için tür bildirimleri (dosya Node'daki değerlendirme betiğinde de derlenmeden çalıştığı için JS)
import type { InferenceSession } from 'onnxruntime-web';

export const SAMPLE_RATE: number;
export const WIN: number;
export const HOP: number;
export const BINS: number;
export const MODEL_LAG_FRAMES: number;
export const ALGORITHMIC_DELAY_SAMPLES: number;

export function vorbisWindow(n: number): Float32Array;
export function readOnnxMetadata(bytes: ArrayBuffer | Uint8Array): Record<string, string>;
export function initialState(meta: Record<string, string>): Float32Array;
export function attenLimitAlpha(db: number): number;

export class ComplexFft {
  constructor(n: number);
  forward(inRe: ArrayLike<number>, inIm: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array): void;
}

export class RealFft {
  constructor(n: number);
  forward(x: ArrayLike<number>, re: Float64Array, im: Float64Array): void;
  inverse(re: ArrayLike<number>, im: ArrayLike<number>, x: Float32Array): void;
}

export class StftFramer {
  analyze(hop: ArrayLike<number>, spec: Float32Array): void;
  synthesize(spec: ArrayLike<number>, out: Float32Array): void;
}

export class DpdfnetDenoiser {
  constructor(
    ort: typeof import('onnxruntime-web'),
    session: InferenceSession,
    meta: Record<string, string>,
    attenLimDb?: number,
  );
  setAttenLimit(db: number): void;
  processHop(hop: Float32Array, out?: Float32Array): Promise<Float32Array>;
}
