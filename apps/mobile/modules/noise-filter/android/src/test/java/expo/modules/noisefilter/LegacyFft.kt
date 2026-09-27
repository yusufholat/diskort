// Önceki (0.6.x) FFT gerçekleştirmesi, olduğu gibi: yeni FFT'nin doğruluk ve hız karşılaştırması için.
// Yalnızca testlerde; uygulamada kullanılmaz.
package expo.modules.noisefilter

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Karışık tabanlı (4/2/3/5) karmaşık FFT; 960 gibi 2'nin kuvveti olmayan boyutlar için. Bellek ayırmaz. */
class LegacyComplexFft(private val n: Int) {
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
class LegacyRealFft(private val n: Int) {
  private val fft = LegacyComplexFft(n)
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
