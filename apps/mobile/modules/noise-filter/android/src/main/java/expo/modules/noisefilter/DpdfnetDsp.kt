// DPDFNet (48 kHz, "hr") için akışlı sinyal işleme: STFT/ISTFT, bastırma sınırı ve model başlangıç durumu.
//
// Masaüstündeki gerçekleştirmenin (apps/desktop/src/renderer/src/features/voice/dpdfnet/dsp.js) birebir
// Kotlin karşılığı: Vorbis pencereli STFT (960 örnek pencere, 480 atlama = 10 ms @ 48 kHz) ve
// örtüştür-topla ISTFT. ERB/spektrum normalizasyonu, GRU'lar, maske ve derin filtre ONNX grafiğinin
// içindedir. Bu dosya Android'e bağımlı değildir (JVM birim testi: src/test).
package expo.modules.noisefilter

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

object Dpdfnet {
  const val SAMPLE_RATE = 48000
  const val WIN = 960
  const val HOP = 480
  const val BINS = WIN / 2 + 1

  /** Modelin çıkış karesi girişten bu kadar kare geride (resmi kodda ATTN_LIMIT_NOISY_FRAME_OFFSET). */
  const val MODEL_LAG_FRAMES = 4

  /** Toplam algoritmik gecikme: pencere (1 atlama) + model gecikmesi = 5 × 10 ms. */
  const val ALGORITHMIC_DELAY_SAMPLES = HOP * (MODEL_LAG_FRAMES + 1)

  /** Vorbis penceresi (Princen-Bradley: %50 örtüşmede w² toplamı 1). */
  fun vorbisWindow(n: Int): FloatArray {
    val half = n / 2
    return FloatArray(n) { i ->
      val s = sin(0.5 * PI * (i + 0.5) / half)
      sin(0.5 * PI * s * s).toFloat()
    }
  }

  /** Bastırma sınırı (dB) → özgün (gürültülü) sesin karışım payı. 100 dB ve üstü = sınırsız. */
  fun attenLimitAlpha(db: Double): Float = if (db >= 100) 0f else 10.0.pow(-db / 20).toFloat()

  /** Modelin başlangıç durumu: sıfırlar + metaverideki ERB/spektrum normalizasyon başlangıç değerleri. */
  fun initialState(meta: Map<String, String>): FloatArray {
    val size = meta["state_size"]?.toIntOrNull() ?: 0
    val erbSize = meta["erb_norm_state_size"]?.toIntOrNull() ?: -1
    val specSize = meta["spec_norm_state_size"]?.toIntOrNull() ?: -1
    val erbInit = meta["erb_norm_init"]
    val specInit = meta["spec_norm_init"]
    require(size > 0 && erbInit != null && specInit != null) { "DPDFNet modelinde durum metaverisi yok" }
    val erb = erbInit.split(',').map { it.trim().toFloat() }
    val spec = specInit.split(',').map { it.trim().toFloat() }
    require(erb.size == erbSize && spec.size == specSize && erbSize + specSize <= size) {
      "DPDFNet durum metaverisi tutarsız"
    }
    val state = FloatArray(size)
    for (i in erb.indices) state[i] = erb[i]
    for (i in spec.indices) state[erbSize + i] = spec[i]
    return state
  }
}

/** Karışık tabanlı (4/2/3/5) karmaşık FFT; 960 gibi 2'nin kuvveti olmayan boyutlar için. Bellek ayırmaz. */
class ComplexFft(private val n: Int) {
  private val factors: IntArray = factorize(n)
  private val cosT = DoubleArray(n) { cos(2 * PI * it / n) }
  private val sinT = DoubleArray(n) { sin(2 * PI * it / n) }
  private val tr = DoubleArray(n)
  private val ti = DoubleArray(n)

  /** İleri dönüşüm: X[k] = Σ x[j]·e^(−2πijk/n). Giriş ve çıkış dizileri farklı olmalı. */
  fun forward(inRe: DoubleArray, inIm: DoubleArray, outRe: DoubleArray, outIm: DoubleArray) {
    rec(n, 0, inRe, inIm, 0, 1, outRe, outIm, 0)
  }

  private fun rec(
    len: Int,
    fi: Int,
    inRe: DoubleArray,
    inIm: DoubleArray,
    inOff: Int,
    stride: Int,
    outRe: DoubleArray,
    outIm: DoubleArray,
    outOff: Int,
  ) {
    if (len == 1) {
      outRe[outOff] = inRe[inOff]
      outIm[outOff] = inIm[inOff]
      return
    }
    val p = factors[fi]
    val m = len / p
    for (q in 0 until p) {
      rec(m, fi + 1, inRe, inIm, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m)
    }
    // out[outOff + q·m + k] = Y_q[k];  X[k + r·m] = Σ_q Y_q[k]·W_len^(q·(k + r·m))
    val step = n / len
    for (k in 0 until m) {
      for (r in 0 until p) {
        val kk = k + r * m
        var sr = 0.0
        var si = 0.0
        for (q in 0 until p) {
          val idx = ((q * kk) % len) * step
          val c = cosT[idx]
          val s = sinT[idx]
          val yr = outRe[outOff + q * m + k]
          val yi = outIm[outOff + q * m + k]
          sr += yr * c + yi * s
          si += yi * c - yr * s
        }
        tr[outOff + kk] = sr
        ti[outOff + kk] = si
      }
    }
    for (j in outOff until outOff + len) {
      outRe[j] = tr[j]
      outIm[j] = ti[j]
    }
  }

  private companion object {
    fun factorize(value: Int): IntArray {
      var n = value
      val f = ArrayList<Int>()
      for (p in intArrayOf(4, 2, 3, 5)) {
        while (n % p == 0) {
          f.add(p)
          n /= p
        }
      }
      var p = 7
      while (n > 1) {
        while (n % p == 0) {
          f.add(p)
          n /= p
        }
        p += 2
      }
      return f.toIntArray()
    }
  }
}

/** Gerçek sinyal FFT'si (numpy.fft.rfft / irfft ile aynı ölçek). */
class RealFft(private val n: Int) {
  private val fft = ComplexFft(n)
  private val aRe = DoubleArray(n)
  private val aIm = DoubleArray(n)
  private val bRe = DoubleArray(n)
  private val bIm = DoubleArray(n)

  /** x (n örnek) → re/im (n/2+1 kutu) */
  fun forward(x: FloatArray, re: DoubleArray, im: DoubleArray) {
    for (i in 0 until n) {
      aRe[i] = x[i].toDouble()
      aIm[i] = 0.0
    }
    fft.forward(aRe, aIm, bRe, bIm)
    for (k in 0..n / 2) {
      re[k] = bRe[k]
      im[k] = bIm[k]
    }
  }

  /** re/im (n/2+1 kutu, Hermitsel kabul edilir) → x (n örnek), 1/n ölçekli */
  fun inverse(re: DoubleArray, im: DoubleArray, x: FloatArray) {
    val half = n / 2
    // Eşlenik hilesi: x = conj(FFT(conj(X))) / n. DC ve Nyquist kutularının sanal kısmı yok sayılır.
    for (k in 0..half) {
      aRe[k] = re[k]
      aIm[k] = if (k == 0 || k == half) 0.0 else -im[k]
    }
    for (k in half + 1 until n) {
      aRe[k] = re[n - k]
      aIm[k] = im[n - k]
    }
    fft.forward(aRe, aIm, bRe, bIm)
    for (i in 0 until n) x[i] = (bRe[i] / n).toFloat()
  }
}

/**
 * Akışlı STFT/ISTFT çerçeveleyici. Her 480 örneklik atlamada bir kare üretir ve bir kare alır.
 * Kare biçimi modelin beklediği gibidir: [kutu][re, im] sıralı FloatArray(481·2).
 */
class StftFramer {
  private val window = Dpdfnet.vorbisWindow(Dpdfnet.WIN)
  private val fft = RealFft(Dpdfnet.WIN)
  private val inBuf = FloatArray(Dpdfnet.WIN)
  private val frame = FloatArray(Dpdfnet.WIN)
  private val re = DoubleArray(Dpdfnet.BINS)
  private val im = DoubleArray(Dpdfnet.BINS)
  private val ola = FloatArray(Dpdfnet.HOP)

  fun reset() {
    inBuf.fill(0f)
    ola.fill(0f)
  }

  /** Yeni 480 örneği ekler, son 960 örneğin pencereli spektrumunu `spec` içine yazar. */
  fun analyze(hop: FloatArray, spec: FloatArray) {
    val h = Dpdfnet.HOP
    System.arraycopy(inBuf, h, inBuf, 0, h)
    System.arraycopy(hop, 0, inBuf, h, h)
    for (i in 0 until Dpdfnet.WIN) frame[i] = inBuf[i] * window[i]
    fft.forward(frame, re, im)
    for (k in 0 until Dpdfnet.BINS) {
      spec[2 * k] = re[k].toFloat()
      spec[2 * k + 1] = im[k].toFloat()
    }
  }

  /** Temizlenmiş kareyi ters dönüştürüp örtüştür-topla ile 480 çıkış örneği üretir. */
  fun synthesize(spec: FloatArray, out: FloatArray) {
    for (k in 0 until Dpdfnet.BINS) {
      re[k] = spec[2 * k].toDouble()
      im[k] = spec[2 * k + 1].toDouble()
    }
    fft.inverse(re, im, frame)
    val h = Dpdfnet.HOP
    for (i in 0 until h) out[i] = frame[i] * window[i] + ola[i]
    for (i in 0 until h) ola[i] = frame[h + i] * window[h + i]
  }
}
