// dfn-engine.js için tür bildirimleri
export class DeepFilterEngine {
  constructor(wasmModule: WebAssembly.Module, modelBytes: ArrayBuffer | Uint8Array, attenLimDb?: number, postFilterBeta?: number);
  readonly frame: number;
  readonly lookahead: number;
  setAttenLimit(db: number): void;
  setPostFilterBeta(beta: number): void;
  processHop(hop: Float32Array, out: Float32Array): Float32Array;
}
