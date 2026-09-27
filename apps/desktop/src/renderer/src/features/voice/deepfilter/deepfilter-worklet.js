// DeepFilterNet 3 gürültü engelleme için AudioWorklet işlemcisi.
// df.wasm, DeepFilterNet'in libDF'inden (MIT/Apache-2.0, © Hendrik Schröter) düz bir C ABI sarmalayıcısıyla
// derlenir ve hiçbir JS içe aktarımı istemez (ayrıntılar: LICENSE-DeepFilterNet.txt). Wasm modülü ve model ana iş
// parçacığında yüklenip derlenir, processorOptions ile buraya gelir.
//
// DFN3 480 örneklik (10 ms) karelerle çalışır; Web Audio ise 128'lik bloklar verir. Çıkış tamponu
// (kare − ebob(128, kare)) = 448 örnek sessizlikle önceden doldurulur: böylece hiç boşluk (underrun)
// olmadan sabit ~9,3 ms tamponlama gecikmesi oluşur. Modelin kendi gecikmesi ~30 ms'dir (STFT + 2 kare ileri bakış).

const BLOCK = 128;
const REPORT_INTERVAL_S = 2;
const WARMUP_FRAMES = 50;
/** Bir ses bloğunun süresi (128 örnek, 48 kHz): bir kare bundan uzun sürerse ses iş parçacığı gecikir */
const QUANTUM_MS = (BLOCK / 48000) * 1000;

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** Wasm tarafındaki son hata metni (AudioWorklet'te TextDecoder olmayabilir; ASCII yeterli). */
function lastError(w) {
  const bytes = new Uint8Array(w.memory.buffer, w.dfw_last_error_ptr(), w.dfw_last_error_len());
  let s = '';
  for (let i = 0; i < bytes.length && i < 500; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
// AudioWorklet kapsamında performance yok; Date.now() 1 ms çözünürlüklü ama çok karede ortalaması doğru çıkar.
const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

class DiskortDeepFilterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ok = false;
    try {
      const { wasmModule, modelBytes, attenLimDb, postFilterBeta } = options.processorOptions;
      const t0 = Date.now();
      const w = new WebAssembly.Instance(wasmModule, {}).exports;
      const model = new Uint8Array(modelBytes);
      const modelPtr = w.dfw_alloc(model.length);
      new Uint8Array(w.memory.buffer, modelPtr, model.length).set(model);
      const st = w.dfw_create(modelPtr, model.length, attenLimDb ?? 100, postFilterBeta ?? 0);
      w.dfw_free(modelPtr, model.length);
      if (!st) throw new Error(`DeepFilterNet modeli yüklenemedi: ${lastError(w)}`);

      this.w = w;
      this.st = st;
      this.frame = w.dfw_frame_length(st);
      this.bindViews();
      this.inFill = 0;

      // Isınma: wasm fonksiyonları ilk çağrıda derlenir; bunu canlı sesten önce yapıp ilk saniyedeki
      // takılmaları (10+ ms'lik bloklar) önle. Çok kısık gürültü, modelin tüm katmanlarını çalıştırır.
      let seed = 1;
      for (let f = 0; f < WARMUP_FRAMES; f++) {
        for (let i = 0; i < this.frame; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          this.inView[i] = (seed / 4294967296 - 0.5) * 1e-3;
        }
        w.dfw_process(st);
        if (this.mem !== w.memory.buffer) this.bindViews();
      }

      const prefill = this.frame - gcd(BLOCK, this.frame);
      this.ring = new Float32Array(this.frame * 2 + BLOCK * 2);
      this.readPos = 0;
      this.writePos = prefill; // halka tampon sıfırla başladığından ön doldurma = yazma konumunu ileri almak
      this.underruns = 0;
      this.busyMs = 0;
      this.resetFrameStats();
      this.lastReportS = currentTime;

      this.ok = true;
      this.port.postMessage({
        type: 'ready',
        frame: this.frame,
        lookahead: w.dfw_lookahead(st),
        bufferSamples: prefill,
        initMs: Date.now() - t0,
      });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
    // Bastırma sınırı (gürültü engelleme gücü ayarı) ve son filtre çalışırken değiştirilebilir
    this.port.onmessage = (e) => {
      if (!this.ok) return;
      if (typeof e.data.attenLimDb === 'number') this.w.dfw_set_atten_lim(this.st, e.data.attenLimDb);
      if (typeof e.data.postFilterBeta === 'number') this.w.dfw_set_post_filter_beta(this.st, e.data.postFilterBeta);
    };
  }

  resetFrameStats() {
    this.frames = 0;
    this.maxFrameMs = 0;
    this.over2ms = 0;
    this.overQuantum = 0;
    // p99 için son aralıktaki kare süreleri (2 sn ≈ 200 kare)
    this.frameTimes = this.frameTimes || new Float32Array(256);
  }

  /** Wasm belleği büyürse eski görünümler geçersiz kalır; yeniden bağla. */
  bindViews() {
    this.mem = this.w.memory.buffer;
    this.inView = new Float32Array(this.mem, this.w.dfw_input_ptr(this.st), this.frame);
    this.outView = new Float32Array(this.mem, this.w.dfw_output_ptr(this.st), this.frame);
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const input = inputs[0] && inputs[0][0];
    const n = out[0].length;

    if (!this.ok) {
      // Yüklenemediyse sesi olduğu gibi geçir (ana taraf zaten standart engellemeye döner).
      for (const ch of out) {
        if (input) ch.set(input);
        else ch.fill(0);
      }
      return true;
    }

    const size = this.ring.length;
    for (let i = 0; i < n; i++) {
      this.inView[this.inFill++] = input ? input[i] : 0;
      if (this.inFill === this.frame) {
        this.inFill = 0;
        if (!this.runFrame()) return true;
        if (this.mem !== this.w.memory.buffer) this.bindViews();
        for (let j = 0; j < this.frame; j++) {
          this.ring[this.writePos] = this.outView[j];
          this.writePos = (this.writePos + 1) % size;
        }
      }
    }

    const ch0 = out[0];
    const available = (this.writePos - this.readPos + size) % size;
    const take = Math.min(n, available);
    for (let i = 0; i < take; i++) {
      ch0[i] = this.ring[this.readPos];
      this.readPos = (this.readPos + 1) % size;
    }
    if (take < n) {
      ch0.fill(0, take);
      this.underruns++;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);

    if (currentTime - this.lastReportS >= REPORT_INTERVAL_S) {
      // İşlemci yükü: işleme süresi / gerçek süre (tek çekirdek oranı)
      const elapsed = currentTime - this.lastReportS;
      const n = Math.min(this.frames, this.frameTimes.length);
      const sorted = Array.prototype.slice.call(this.frameTimes, 0, n).sort((a, b) => a - b);
      this.port.postMessage({
        type: 'stats',
        load: this.busyMs / 1000 / elapsed,
        underruns: this.underruns,
        frames: this.frames,
        avgFrameMs: this.frames ? this.busyMs / this.frames : 0,
        maxFrameMs: this.maxFrameMs,
        p99FrameMs: n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0,
        over2ms: this.over2ms,
        overQuantum: this.overQuantum,
      });
      this.busyMs = 0;
      this.resetFrameStats();
      this.lastReportS = currentTime;
    }
    return true;
  }

  runFrame() {
    try {
      if (this.mem !== this.w.memory.buffer) this.bindViews();
      const t0 = now();
      const lsnr = this.w.dfw_process(this.st);
      const dt = now() - t0;
      this.busyMs += dt;
      // Kare tek bir ses bloğunun içinde eşzamanlı işlenir: blok süresini aşan kare çıkışı geciktirir (cızırtı).
      // Not: performance yoksa Date.now() 1 ms çözünürlüklüdür; süreler tam ms'ye yuvarlanmış olur.
      if (this.frames < this.frameTimes.length) this.frameTimes[this.frames] = dt;
      this.frames++;
      if (dt > this.maxFrameMs) this.maxFrameMs = dt;
      if (dt > 2) this.over2ms++;
      if (dt > QUANTUM_MS) this.overQuantum++;
      if (Number.isNaN(lsnr)) throw new Error(`DeepFilterNet karesi işlenemedi: ${lastError(this.w)}`);
      return true;
    } catch (err) {
      // Wasm içinde hata olursa durumu güvenilmez sayılır: geçirgen moda düş ve ana tarafa bildir.
      this.ok = false;
      this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
      return false;
    }
  }
}

registerProcessor('diskort-deepfilter', DiskortDeepFilterProcessor);
