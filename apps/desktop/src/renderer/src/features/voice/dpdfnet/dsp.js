// DPDFNet (48 kHz, "hr") için akışlı sinyal işleme: STFT/ISTFT, model durumu ve bastırma sınırı.
//
// Model (Ceva DPDFNet, Apache-2.0) tek bir ONNX grafiğidir: girişte bir STFT karesi [1,1,481,2] ve düz bir
// durum vektörü, çıkışta temizlenmiş kare ve yeni durum. ERB/spektrum normalizasyonu, GRU'lar, maske ve derin
// filtre grafiğin içindedir; dışarıda yalnızca Vorbis pencereli STFT (960 örnek pencere, 480 atlama = 10 ms)
// ve örtüştür-topla ISTFT kalır. Resmi Python gerçekleştirmesiyle (onnx_model/infer_dpdfnet_onnx.py) aynıdır.
//
// Bu dosya hem ses işçisinde (dpdfnet.worker.ts) hem de Node'daki değerlendirme betiğinde
// (apps/desktop/scripts/gurultu-degerlendir.mjs) çalışır; tarayıcıya/Node'a özgü hiçbir şey kullanmaz.

export const SAMPLE_RATE = 48000;
export const WIN = 960;
export const HOP = 480;
export const BINS = WIN / 2 + 1;
/**
 * Modelin çıkış karesi, girişten bu kadar kare geride kalır (resmi kodda ATTN_LIMIT_NOISY_FRAME_OFFSET;
 * ölçümle doğrulandı). Bastırma sınırı karışımında gürültülü kare bu kadar geciktirilir.
 */
export const MODEL_LAG_FRAMES = 4;
/** Toplam algoritmik gecikme: pencere (1 atlama) + model gecikmesi = 5 × 10 ms. */
export const ALGORITHMIC_DELAY_SAMPLES = HOP * (MODEL_LAG_FRAMES + 1);

/** Vorbis penceresi (Princen-Bradley: %50 örtüşmede w² toplamı 1, ISTFT'de ek normalizasyon gerekmez). */
export function vorbisWindow(n) {
  const w = new Float32Array(n);
  const half = n / 2;
  for (let i = 0; i < n; i++) {
    const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / half);
    w[i] = Math.sin(0.5 * Math.PI * s * s);
  }
  return w;
}

function factorize(n) {
  const f = [];
  for (const p of [4, 2, 3, 5]) {
    while (n % p === 0) {
      f.push(p);
      n /= p;
    }
  }
  for (let p = 7; n > 1; p += 2) {
    while (n % p === 0) {
      f.push(p);
      n /= p;
    }
  }
  return f;
}

/** Karışık tabanlı (4/2/3/5) karmaşık FFT; 960 gibi 2'nin kuvveti olmayan boyutlar için. Bellek ayırmaz. */
export class ComplexFft {
  constructor(n) {
    this.n = n;
    this.factors = factorize(n);
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.tr = new Float64Array(n);
    this.ti = new Float64Array(n);
  }

  /** İleri dönüşüm: X[k] = Σ x[j]·e^(−2πijk/n). Giriş ve çıkış dizileri farklı olmalı. */
  forward(inRe, inIm, outRe, outIm) {
    this.rec(this.n, 0, inRe, inIm, 0, 1, outRe, outIm, 0);
  }

  rec(n, fi, inRe, inIm, inOff, stride, outRe, outIm, outOff) {
    if (n === 1) {
      outRe[outOff] = inRe[inOff];
      outIm[outOff] = inIm[inOff];
      return;
    }
    const p = this.factors[fi];
    const m = n / p;
    for (let q = 0; q < p; q++) {
      this.rec(m, fi + 1, inRe, inIm, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m);
    }
    // out[outOff + q·m + k] = Y_q[k];  X[k + r·m] = Σ_q Y_q[k]·W_n^(q·(k + r·m))
    const step = this.n / n;
    const { cos, sin, tr, ti } = this;
    for (let k = 0; k < m; k++) {
      for (let r = 0; r < p; r++) {
        const kk = k + r * m;
        let sr = 0;
        let si = 0;
        for (let q = 0; q < p; q++) {
          const idx = ((q * kk) % n) * step;
          const c = cos[idx];
          const s = sin[idx];
          const yr = outRe[outOff + q * m + k];
          const yi = outIm[outOff + q * m + k];
          sr += yr * c + yi * s;
          si += yi * c - yr * s;
        }
        tr[outOff + kk] = sr;
        ti[outOff + kk] = si;
      }
    }
    for (let j = outOff; j < outOff + n; j++) {
      outRe[j] = tr[j];
      outIm[j] = ti[j];
    }
  }
}

/** Gerçek sinyal FFT'si (numpy.fft.rfft / irfft ile aynı ölçek). */
export class RealFft {
  constructor(n) {
    this.n = n;
    this.fft = new ComplexFft(n);
    this.aRe = new Float64Array(n);
    this.aIm = new Float64Array(n);
    this.bRe = new Float64Array(n);
    this.bIm = new Float64Array(n);
  }

  /** x (n örnek) → re/im (n/2+1 kutu) */
  forward(x, re, im) {
    const { aRe, aIm, bRe, bIm } = this;
    for (let i = 0; i < this.n; i++) {
      aRe[i] = x[i];
      aIm[i] = 0;
    }
    this.fft.forward(aRe, aIm, bRe, bIm);
    for (let k = 0; k <= this.n / 2; k++) {
      re[k] = bRe[k];
      im[k] = bIm[k];
    }
  }

  /** re/im (n/2+1 kutu, Hermitsel kabul edilir) → x (n örnek), 1/n ölçekli */
  inverse(re, im, x) {
    const { n, aRe, aIm, bRe, bIm } = this;
    const half = n / 2;
    // Eşlenik hilesi: x = conj(FFT(conj(X))) / n. DC ve Nyquist kutularının sanal kısmı yok sayılır (irfft gibi).
    for (let k = 0; k <= half; k++) {
      aRe[k] = re[k];
      aIm[k] = k === 0 || k === half ? 0 : -im[k];
    }
    for (let k = half + 1; k < n; k++) {
      aRe[k] = re[n - k];
      aIm[k] = im[n - k];
    }
    this.fft.forward(aRe, aIm, bRe, bIm);
    for (let i = 0; i < n; i++) x[i] = bRe[i] / n;
  }
}

/**
 * Akışlı STFT/ISTFT çerçeveleyici. Her 480 örneklik atlamada bir kare üretir ve bir kare alır.
 * Kare biçimi modelin beklediği gibidir: [kutu][re, im] sıralı Float32Array(481·2).
 */
export class StftFramer {
  constructor() {
    this.window = vorbisWindow(WIN);
    this.fft = new RealFft(WIN);
    this.inBuf = new Float32Array(WIN);
    this.frame = new Float32Array(WIN);
    this.re = new Float64Array(BINS);
    this.im = new Float64Array(BINS);
    this.ola = new Float32Array(HOP);
  }

  /** Yeni 480 örneği ekler, son 960 örneğin pencereli spektrumunu `spec` içine yazar. */
  analyze(hop, spec) {
    const { inBuf, frame, window, re, im } = this;
    inBuf.copyWithin(0, HOP);
    inBuf.set(hop, HOP);
    for (let i = 0; i < WIN; i++) frame[i] = inBuf[i] * window[i];
    this.fft.forward(frame, re, im);
    for (let k = 0; k < BINS; k++) {
      spec[2 * k] = re[k];
      spec[2 * k + 1] = im[k];
    }
  }

  /** Temizlenmiş kareyi ters dönüştürüp örtüştür-topla ile 480 çıkış örneği üretir. */
  synthesize(spec, out) {
    const { frame, window, re, im, ola } = this;
    for (let k = 0; k < BINS; k++) {
      re[k] = spec[2 * k];
      im[k] = spec[2 * k + 1];
    }
    this.fft.inverse(re, im, frame);
    for (let i = 0; i < HOP; i++) out[i] = frame[i] * window[i] + ola[i];
    for (let i = 0; i < HOP; i++) ola[i] = frame[HOP + i] * window[HOP + i];
  }
}

/**
 * ONNX dosyasının üst düzey metadata_props alanlarını (ModelProto alan 14) okur. onnxruntime-web oturumu
 * özel metaveriyi vermediği için protobuf elle taranır; yalnızca üst düzey alanlar atlanarak geçilir.
 */
export function readOnnxMetadata(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let pos = 0;
  const varint = () => {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = u8[pos++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  };
  const text = (start, end) => {
    let s = '';
    for (let i = start; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  };
  const meta = {};
  while (pos < u8.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      const len = varint();
      const end = pos + len;
      if (field === 14) {
        // StringStringEntryProto { key = 1; value = 2 }
        let k = '';
        let v = '';
        while (pos < end) {
          const kk = varint();
          const l = varint();
          if (kk >> 3 === 1) k = text(pos, pos + l);
          else if (kk >> 3 === 2) v = text(pos, pos + l);
          pos += l;
        }
        meta[k] = v;
      }
      pos = end;
    } else throw new Error(`ONNX dosyası okunamadı (tel türü ${wire})`);
  }
  return meta;
}

/** Modelin başlangıç durumu: sıfırlar + metaverideki ERB/spektrum normalizasyon başlangıç değerleri. */
export function initialState(meta) {
  const size = Number(meta.state_size);
  const erbSize = Number(meta.erb_norm_state_size);
  const specSize = Number(meta.spec_norm_state_size);
  if (!(size > 0) || !meta.erb_norm_init || !meta.spec_norm_init) {
    throw new Error('DPDFNet modelinde durum metaverisi yok');
  }
  const state = new Float32Array(size);
  const erb = meta.erb_norm_init.split(',').map(Number);
  const spec = meta.spec_norm_init.split(',').map(Number);
  if (erb.length !== erbSize || spec.length !== specSize) throw new Error('DPDFNet durum metaverisi tutarsız');
  state.set(erb, 0);
  state.set(spec, erbSize);
  return state;
}

/** Bastırma sınırı (dB) → özgün (gürültülü) sesin karışım payı. 100 dB ve üstü = sınırsız. */
export function attenLimitAlpha(db) {
  return db >= 100 ? 0 : Math.pow(10, -db / 20);
}

/**
 * DPDFNet akışlı gürültü engelleyici. `ort` onnxruntime-web (veya -node) modülüdür; oturum dışarıda kurulur.
 * processHop 480 giriş örneği alır, 480 temizlenmiş örnek döndürür (ALGORITHMIC_DELAY_SAMPLES gecikmeli).
 */
export class DpdfnetDenoiser {
  constructor(ort, session, meta, attenLimDb = 100) {
    this.ort = ort;
    this.session = session;
    this.inSpec = session.inputNames[0];
    this.inState = session.inputNames[1];
    this.outSpec = session.outputNames[0];
    this.outState = session.outputNames[1];
    this.stateData = initialState(meta);
    this.framer = new StftFramer();
    this.spec = new Float32Array(BINS * 2);
    this.mixed = new Float32Array(BINS * 2);
    // Bastırma sınırı karışımı için gürültülü karelerin kısa geçmişi (model gecikmesi kadar)
    this.history = Array.from({ length: MODEL_LAG_FRAMES + 1 }, () => new Float32Array(BINS * 2));
    this.historyPos = 0;
    this.alpha = attenLimitAlpha(attenLimDb);
  }

  setAttenLimit(db) {
    this.alpha = attenLimitAlpha(db);
  }

  async processHop(hop, out = new Float32Array(HOP)) {
    const { ort, spec } = this;
    this.framer.analyze(hop, spec);
    const slot = this.history[this.historyPos];
    slot.set(spec);
    this.historyPos = (this.historyPos + 1) % this.history.length;

    const res = await this.session.run({
      [this.inSpec]: new ort.Tensor('float32', spec, [1, 1, BINS, 2]),
      [this.inState]: new ort.Tensor('float32', this.stateData, [this.stateData.length]),
    });
    const enhanced = res[this.outSpec].data;
    this.stateData = res[this.outState].data;

    let result = enhanced;
    if (this.alpha > 0) {
      // Model çıkışı MODEL_LAG_FRAMES kare geride: aynı anın gürültülü karesiyle karıştır
      // (history dizisinin en eski elemanı, yani bir sonraki yazılacak yuva).
      const noisy = this.history[this.historyPos];
      const a = this.alpha;
      const mixed = this.mixed;
      for (let i = 0; i < mixed.length; i++) mixed[i] = a * noisy[i] + (1 - a) * enhanced[i];
      result = mixed;
    }
    this.framer.synthesize(result, out);
    return out;
  }
}
