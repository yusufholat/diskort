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

/**
 * Karışık tabanlı (2/3/4/5) karmaşık FFT, Stockham düzeninde (kendiliğinden sıralı, özyinelemesiz).
 * Her aşamanın dönme çarpanları önceden hesaplanır; kare başına bellek ayırmaz, mod/bölme yapmaz.
 * 480 = 4·4·2·3·5 (960 örneklik gerçek FFT'nin yarısı) için yazıldı; 2, 3 ve 5'in her çarpımında çalışır.
 */
class ComplexFft(private val n: Int) {
  private val radices: IntArray = factorize(n)

  /** Aşama başına dönme çarpanları: tw[s][2·((r−1)·p + (k−1))] = cos, +1 = −sin (e^(−2πi·p·k/len)) */
  private val twiddles: Array<DoubleArray>
  private val workRe = DoubleArray(n)
  private val workIm = DoubleArray(n)

  init {
    var len = n
    twiddles = Array(radices.size) { s ->
      val r = radices[s]
      val m = len / r
      val t = DoubleArray(2 * m * (r - 1))
      for (p in 0 until m) {
        for (k in 1 until r) {
          val a = -2 * PI * p * k / len
          t[2 * (p * (r - 1) + k - 1)] = cos(a)
          t[2 * (p * (r - 1) + k - 1) + 1] = sin(a)
        }
      }
      len = m
      t
    }
  }

  /** Yerinde ileri dönüşüm: X[k] = Σ x[j]·e^(−2πijk/n). */
  fun forward(re: DoubleArray, im: DoubleArray) {
    var xr = re
    var xi = im
    var yr = workRe
    var yi = workIm
    var len = n
    var s = 1
    for (stage in radices.indices) {
      val r = radices[stage]
      val m = len / r
      val tw = twiddles[stage]
      when (r) {
        4 -> radix4(m, s, xr, xi, yr, yi, tw)
        2 -> radix2(m, s, xr, xi, yr, yi, tw)
        3 -> radix3(m, s, xr, xi, yr, yi, tw)
        5 -> radix5(m, s, xr, xi, yr, yi, tw)
        else -> error("desteklenmeyen taban $r")
      }
      val tr = xr
      xr = yr
      yr = tr
      val ti = xi
      xi = yi
      yi = ti
      len = m
      s *= r
    }
    if (xr !== re) {
      System.arraycopy(xr, 0, re, 0, n)
      System.arraycopy(xi, 0, im, 0, n)
    }
  }

  // Stockham DIF aşaması (taban r): a_j = x[q + s(p + j·m)], y[q + s(r·p + k)] = (Σ_j a_j·e^(−2πijk/r))·w^(p·k)

  private fun radix2(m: Int, s: Int, xr: DoubleArray, xi: DoubleArray, yr: DoubleArray, yi: DoubleArray, tw: DoubleArray) {
    val sm = s * m
    for (p in 0 until m) {
      val w1r = tw[2 * p]
      val w1i = tw[2 * p + 1]
      val i0 = s * p
      val o0 = s * 2 * p
      for (q in 0 until s) {
        val a = i0 + q
        val b = a + sm
        val ar = xr[a]
        val ai = xi[a]
        val br = xr[b]
        val bi = xi[b]
        val o = o0 + q
        yr[o] = ar + br
        yi[o] = ai + bi
        val dr = ar - br
        val di = ai - bi
        yr[o + s] = dr * w1r - di * w1i
        yi[o + s] = dr * w1i + di * w1r
      }
    }
  }

  private fun radix3(m: Int, s: Int, xr: DoubleArray, xi: DoubleArray, yr: DoubleArray, yi: DoubleArray, tw: DoubleArray) {
    val sm = s * m
    for (p in 0 until m) {
      val w1r = tw[4 * p]
      val w1i = tw[4 * p + 1]
      val w2r = tw[4 * p + 2]
      val w2i = tw[4 * p + 3]
      val i0 = s * p
      val o0 = s * 3 * p
      for (q in 0 until s) {
        val a = i0 + q
        val a0r = xr[a]
        val a0i = xi[a]
        val a1r = xr[a + sm]
        val a1i = xi[a + sm]
        val a2r = xr[a + 2 * sm]
        val a2i = xi[a + 2 * sm]
        val tr = a1r + a2r
        val ti = a1i + a2i
        val o = o0 + q
        yr[o] = a0r + tr
        yi[o] = a0i + ti
        val mr = a0r - 0.5 * tr
        val mi = a0i - 0.5 * ti
        // −i·sin(2π/3)·(a1 − a2)
        val ur = SIN60 * (a1i - a2i)
        val ui = -SIN60 * (a1r - a2r)
        val b1r = mr + ur
        val b1i = mi + ui
        val b2r = mr - ur
        val b2i = mi - ui
        yr[o + s] = b1r * w1r - b1i * w1i
        yi[o + s] = b1r * w1i + b1i * w1r
        yr[o + 2 * s] = b2r * w2r - b2i * w2i
        yi[o + 2 * s] = b2r * w2i + b2i * w2r
      }
    }
  }

  private fun radix4(m: Int, s: Int, xr: DoubleArray, xi: DoubleArray, yr: DoubleArray, yi: DoubleArray, tw: DoubleArray) {
    val sm = s * m
    for (p in 0 until m) {
      val w1r = tw[6 * p]
      val w1i = tw[6 * p + 1]
      val w2r = tw[6 * p + 2]
      val w2i = tw[6 * p + 3]
      val w3r = tw[6 * p + 4]
      val w3i = tw[6 * p + 5]
      val i0 = s * p
      val o0 = s * 4 * p
      for (q in 0 until s) {
        val a = i0 + q
        val a0r = xr[a]
        val a0i = xi[a]
        val a1r = xr[a + sm]
        val a1i = xi[a + sm]
        val a2r = xr[a + 2 * sm]
        val a2i = xi[a + 2 * sm]
        val a3r = xr[a + 3 * sm]
        val a3i = xi[a + 3 * sm]
        val t0r = a0r + a2r
        val t0i = a0i + a2i
        val t1r = a0r - a2r
        val t1i = a0i - a2i
        val t2r = a1r + a3r
        val t2i = a1i + a3i
        // −i·(a1 − a3)
        val t3r = a1i - a3i
        val t3i = a3r - a1r
        val o = o0 + q
        yr[o] = t0r + t2r
        yi[o] = t0i + t2i
        val b1r = t1r + t3r
        val b1i = t1i + t3i
        val b2r = t0r - t2r
        val b2i = t0i - t2i
        val b3r = t1r - t3r
        val b3i = t1i - t3i
        yr[o + s] = b1r * w1r - b1i * w1i
        yi[o + s] = b1r * w1i + b1i * w1r
        yr[o + 2 * s] = b2r * w2r - b2i * w2i
        yi[o + 2 * s] = b2r * w2i + b2i * w2r
        yr[o + 3 * s] = b3r * w3r - b3i * w3i
        yi[o + 3 * s] = b3r * w3i + b3i * w3r
      }
    }
  }

  private fun radix5(m: Int, s: Int, xr: DoubleArray, xi: DoubleArray, yr: DoubleArray, yi: DoubleArray, tw: DoubleArray) {
    val sm = s * m
    for (p in 0 until m) {
      val w1r = tw[8 * p]
      val w1i = tw[8 * p + 1]
      val w2r = tw[8 * p + 2]
      val w2i = tw[8 * p + 3]
      val w3r = tw[8 * p + 4]
      val w3i = tw[8 * p + 5]
      val w4r = tw[8 * p + 6]
      val w4i = tw[8 * p + 7]
      val i0 = s * p
      val o0 = s * 5 * p
      for (q in 0 until s) {
        val a = i0 + q
        val a0r = xr[a]
        val a0i = xi[a]
        val a1r = xr[a + sm]
        val a1i = xi[a + sm]
        val a2r = xr[a + 2 * sm]
        val a2i = xi[a + 2 * sm]
        val a3r = xr[a + 3 * sm]
        val a3i = xi[a + 3 * sm]
        val a4r = xr[a + 4 * sm]
        val a4i = xi[a + 4 * sm]
        val t1r = a1r + a4r
        val t1i = a1i + a4i
        val t2r = a2r + a3r
        val t2i = a2i + a3i
        val d1r = a1r - a4r
        val d1i = a1i - a4i
        val d2r = a2r - a3r
        val d2i = a2i - a3i
        val o = o0 + q
        yr[o] = a0r + t1r + t2r
        yi[o] = a0i + t1i + t2i
        val m1r = a0r + C72 * t1r + C144 * t2r
        val m1i = a0i + C72 * t1i + C144 * t2i
        val m2r = a0r + C144 * t1r + C72 * t2r
        val m2i = a0i + C144 * t1i + C72 * t2i
        // −i·v: (v.im, −v.re)
        val v1r = S72 * d1r + S144 * d2r
        val v1i = S72 * d1i + S144 * d2i
        val v2r = S144 * d1r - S72 * d2r
        val v2i = S144 * d1i - S72 * d2i
        val b1r = m1r + v1i
        val b1i = m1i - v1r
        val b4r = m1r - v1i
        val b4i = m1i + v1r
        val b2r = m2r + v2i
        val b2i = m2i - v2r
        val b3r = m2r - v2i
        val b3i = m2i + v2r
        yr[o + s] = b1r * w1r - b1i * w1i
        yi[o + s] = b1r * w1i + b1i * w1r
        yr[o + 2 * s] = b2r * w2r - b2i * w2i
        yi[o + 2 * s] = b2r * w2i + b2i * w2r
        yr[o + 3 * s] = b3r * w3r - b3i * w3i
        yi[o + 3 * s] = b3r * w3i + b3i * w3r
        yr[o + 4 * s] = b4r * w4r - b4i * w4i
        yi[o + 4 * s] = b4r * w4i + b4i * w4r
      }
    }
  }

  private companion object {
    val SIN60 = sin(PI / 3)
    val C72 = cos(2 * PI / 5)
    val C144 = cos(4 * PI / 5)
    val S72 = sin(2 * PI / 5)
    val S144 = sin(4 * PI / 5)

    fun factorize(value: Int): IntArray {
      var n = value
      val f = ArrayList<Int>()
      for (p in intArrayOf(4, 2, 3, 5)) {
        while (n % p == 0) {
          f.add(p)
          n /= p
        }
      }
      require(n == 1) { "FFT boyutu yalnızca 2, 3 ve 5'in çarpımı olabilir: $value" }
      return f.toIntArray()
    }
  }
}

/**
 * Gerçek sinyal FFT'si (numpy.fft.rfft / irfft ile aynı ölçek). n örneklik gerçek dönüşüm, n/2 noktalı
 * karmaşık FFT ile yapılır (çift örnekler gerçel, tek örnekler sanal kısım; sonra ayrıştırma).
 */
class RealFft(private val n: Int) {
  private val half = n / 2
  private val fft = ComplexFft(half)
  private val zr = DoubleArray(half)
  private val zi = DoubleArray(half)

  /** e^(−2πik/n), k = 0..n/2 */
  private val wr = DoubleArray(half + 1) { cos(2 * PI * it / n) }
  private val wi = DoubleArray(half + 1) { -sin(2 * PI * it / n) }

  init {
    require(n % 2 == 0) { "gerçek FFT boyutu çift olmalı" }
  }

  /** x (n örnek) → re/im (n/2+1 kutu) */
  fun forward(x: FloatArray, re: DoubleArray, im: DoubleArray) {
    for (j in 0 until half) {
      zr[j] = x[2 * j].toDouble()
      zi[j] = x[2 * j + 1].toDouble()
    }
    fft.forward(zr, zi)
    // X[k] = E[k] + e^(−2πik/n)·O[k];  E = (Z[k] + conj Z[M−k]) / 2,  O = (Z[k] − conj Z[M−k]) / 2i
    re[0] = zr[0] + zi[0]
    im[0] = 0.0
    re[half] = zr[0] - zi[0]
    im[half] = 0.0
    for (k in 1 until half) {
      val ar = zr[k]
      val ai = zi[k]
      val br = zr[half - k]
      val bi = -zi[half - k]
      val er = 0.5 * (ar + br)
      val ei = 0.5 * (ai + bi)
      // (a − b) / 2i = (ai − bi)/2 − i(ar − br)/2
      val pr = 0.5 * (ai - bi)
      val pi = -0.5 * (ar - br)
      re[k] = er + wr[k] * pr - wi[k] * pi
      im[k] = ei + wr[k] * pi + wi[k] * pr
    }
  }

  /** re/im (n/2+1 kutu, Hermitsel kabul edilir) → x (n örnek), 1/n ölçekli. DC ve Nyquist'in sanal kısmı yok sayılır. */
  fun inverse(re: DoubleArray, im: DoubleArray, x: FloatArray) {
    // E[k] = (X[k] + conj X[M−k]) / 2,  O[k] = (X[k] − conj X[M−k])·e^(+2πik/n) / 2,  Z = E + iO
    // z = IFFT_M(Z) = conj(FFT(conj Z)) / M;  x[2j] = Re z[j], x[2j+1] = Im z[j]
    for (k in 0 until half) {
      val ar = re[k]
      val ai = if (k == 0) 0.0 else im[k]
      val br = re[half - k]
      val bi = if (k == 0) 0.0 else -im[half - k]
      val er = 0.5 * (ar + br)
      val ei = 0.5 * (ai + bi)
      val dr = 0.5 * (ar - br)
      val di = 0.5 * (ai - bi)
      // e^(+2πik/n) = wr − i·wi
      val pr = dr * wr[k] + di * wi[k]
      val pi = di * wr[k] - dr * wi[k]
      // Z = E + i·O, eşleniği alınarak saklanır
      zr[k] = er - pi
      zi[k] = -(ei + pr)
    }
    fft.forward(zr, zi)
    val scale = 1.0 / half
    for (j in 0 until half) {
      x[2 * j] = (zr[j] * scale).toFloat()
      x[2 * j + 1] = (-zi[j] * scale).toFloat()
    }
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
