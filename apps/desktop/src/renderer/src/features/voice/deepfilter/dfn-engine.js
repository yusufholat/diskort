// DeepFilterNet 3 çıkarım motoru (df.wasm üzerinde ince sarmalayıcı). Gürültü engelleme işçisinde
// (denoise.worker.ts) ve Node'daki değerlendirme betiğinde çalışır; ses iş parçacığında çalışmaz.
//
// df.wasm, DeepFilterNet'in libDF'inden (MIT/Apache-2.0, © Hendrik Schröter) düz bir C ABI sarmalayıcısıyla
// derlenir ve hiçbir JS içe aktarımı istemez (ayrıntılar: LICENSE-DeepFilterNet.txt). DFN3 480 örneklik
// (10 ms) karelerle çalışır; modelin kendi gecikmesi ~30 ms'dir (STFT + 2 kare ileri bakış).

/** Wasm tarafındaki son hata metni (ASCII yeterli). */
function lastError(w) {
  const bytes = new Uint8Array(w.memory.buffer, w.dfw_last_error_ptr(), w.dfw_last_error_len());
  let s = '';
  for (let i = 0; i < bytes.length && i < 500; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export class DeepFilterEngine {
  /**
   * @param {WebAssembly.Module} wasmModule derlenmiş df.wasm
   * @param {ArrayBuffer | Uint8Array} modelBytes DeepFilterNet3_onnx.tar.gz içeriği
   * @param {number} attenLimDb bastırma sınırı (dB), 100 = sınırsız
   * @param {number} postFilterBeta son filtre (0 = kapalı)
   */
  constructor(wasmModule, modelBytes, attenLimDb = 100, postFilterBeta = 0) {
    const w = new WebAssembly.Instance(wasmModule, {}).exports;
    const model = modelBytes instanceof Uint8Array ? modelBytes : new Uint8Array(modelBytes);
    const modelPtr = w.dfw_alloc(model.length);
    new Uint8Array(w.memory.buffer, modelPtr, model.length).set(model);
    const st = w.dfw_create(modelPtr, model.length, attenLimDb, postFilterBeta);
    w.dfw_free(modelPtr, model.length);
    if (!st) throw new Error(`DeepFilterNet modeli yüklenemedi: ${lastError(w)}`);
    this.w = w;
    this.st = st;
    /** Kare uzunluğu (örnek) */
    this.frame = w.dfw_frame_length(st);
    this.lookahead = w.dfw_lookahead(st);
    this.bindViews();
  }

  /** Wasm belleği büyürse eski görünümler geçersiz kalır; yeniden bağla. */
  bindViews() {
    this.mem = this.w.memory.buffer;
    this.inView = new Float32Array(this.mem, this.w.dfw_input_ptr(this.st), this.frame);
    this.outView = new Float32Array(this.mem, this.w.dfw_output_ptr(this.st), this.frame);
  }

  setAttenLimit(db) {
    this.w.dfw_set_atten_lim(this.st, db);
  }

  setPostFilterBeta(beta) {
    this.w.dfw_set_post_filter_beta(this.st, beta);
  }

  /** Bir kare (frame örnek) işler; `out` girişle aynı dizi olabilir. */
  processHop(hop, out) {
    if (this.mem !== this.w.memory.buffer) this.bindViews();
    this.inView.set(hop);
    const lsnr = this.w.dfw_process(this.st);
    if (Number.isNaN(lsnr)) throw new Error(`DeepFilterNet karesi işlenemedi: ${lastError(this.w)}`);
    if (this.mem !== this.w.memory.buffer) this.bindViews();
    out.set(this.outView);
    return out;
  }
}
