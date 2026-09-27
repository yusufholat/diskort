package expo.modules.noisefilter

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** Masaüstündeki dsp.js'in Kotlin karşılığının doğruluğu (JVM'de, telefonsuz). */
class DpdfnetDspTest {
  @Test
  fun realFftMatchesNaiveDft() {
    val n = Dpdfnet.WIN
    val rnd = Random(7)
    val x = FloatArray(n) { rnd.nextFloat() * 2 - 1 }
    val re = DoubleArray(n / 2 + 1)
    val im = DoubleArray(n / 2 + 1)
    RealFft(n).forward(x, re, im)
    for (k in 0..n / 2) {
      var sr = 0.0
      var si = 0.0
      for (j in 0 until n) {
        val a = 2 * PI * j * k / n
        sr += x[j] * cos(a)
        si -= x[j] * sin(a)
      }
      assertEquals("re[$k]", sr, re[k], 1e-6)
      assertEquals("im[$k]", si, im[k], 1e-6)
    }
  }

  @Test
  fun complexFftMatchesNaiveDft() {
    for (n in intArrayOf(1, 2, 3, 4, 5, 8, 15, 60, 480, 960)) {
      val rnd = Random(n)
      val xr = DoubleArray(n) { rnd.nextDouble() * 2 - 1 }
      val xi = DoubleArray(n) { rnd.nextDouble() * 2 - 1 }
      val re = xr.copyOf()
      val im = xi.copyOf()
      ComplexFft(n).forward(re, im)
      for (k in 0 until n) {
        var sr = 0.0
        var si = 0.0
        for (j in 0 until n) {
          val a = -2 * PI * ((j.toLong() * k) % n) / n
          sr += xr[j] * cos(a) - xi[j] * sin(a)
          si += xr[j] * sin(a) + xi[j] * cos(a)
        }
        assertEquals("n=$n re[$k]", sr, re[k], 1e-9)
        assertEquals("n=$n im[$k]", si, im[k], 1e-9)
      }
    }
  }

  @Test
  fun realFftMatchesPreviousImplementation() {
    // Yeni FFT, önceki sürümdekiyle (LegacyFft.kt) aynı sonucu vermeli; ters dönüşümde DC/Nyquist sanal kısmı yok sayılır
    val n = Dpdfnet.WIN
    val rnd = Random(5)
    val fresh = RealFft(n)
    val legacy = LegacyRealFft(n)
    repeat(20) {
      val x = FloatArray(n) { rnd.nextFloat() * 2 - 1 }
      val re1 = DoubleArray(n / 2 + 1)
      val im1 = DoubleArray(n / 2 + 1)
      val re2 = DoubleArray(n / 2 + 1)
      val im2 = DoubleArray(n / 2 + 1)
      fresh.forward(x, re1, im1)
      legacy.forward(x, re2, im2)
      for (k in 0..n / 2) {
        assertEquals(re2[k], re1[k], 1e-9)
        assertEquals(im2[k], im1[k], 1e-9)
      }
      im1[0] = 0.7
      im1[n / 2] = -0.3
      val y1 = FloatArray(n)
      val y2 = FloatArray(n)
      fresh.inverse(re1, im1, y1)
      legacy.inverse(re1, im1, y2)
      assertArrayEquals(y2, y1, 1e-6f)
    }
  }

  /**
   * Kare başına DSP süresi (JVM'de; telefonda mutlak değer farklı, oran benzer). CI günlüğünde görünür.
   * Hız eşiği yok (paylaşımlı CI makinesinde gürültülü); yalnızca ölçüm.
   */
  @Test
  fun dspBenchmark() {
    val n = Dpdfnet.WIN
    val rnd = Random(1)
    val x = FloatArray(n) { rnd.nextFloat() * 2 - 1 }
    val y = FloatArray(n)
    val re = DoubleArray(n / 2 + 1)
    val im = DoubleArray(n / 2 + 1)
    fun time(label: String, frames: Int, body: () -> Unit): Double {
      repeat(frames) { body() } // ısınma (JIT)
      val start = System.nanoTime()
      repeat(frames) { body() }
      val us = (System.nanoTime() - start) / 1e3 / frames
      println(String.format("DSP ölçümü: %-36s %8.2f µs/kare", label, us))
      return us
    }
    val legacy = LegacyRealFft(n)
    val fresh = RealFft(n)
    val old = time("önceki FFT (ileri + ters, 960)", 3000) {
      legacy.forward(x, re, im)
      legacy.inverse(re, im, y)
    }
    val new = time("yeni FFT (ileri + ters, 960)", 3000) {
      fresh.forward(x, re, im)
      fresh.inverse(re, im, y)
    }
    println(String.format("DSP ölçümü: FFT hızlanması %.1f kat", old / new))
    val framer = StftFramer()
    val hop = FloatArray(Dpdfnet.HOP) { rnd.nextFloat() - 0.5f }
    val spec = FloatArray(Dpdfnet.BINS * 2)
    val out = FloatArray(Dpdfnet.HOP)
    time("StftFramer (analiz + sentez)", 3000) {
      framer.analyze(hop, spec)
      framer.synthesize(spec, out)
    }
  }

  @Test
  fun inverseFftRestoresSignal() {
    val n = Dpdfnet.WIN
    val rnd = Random(3)
    val x = FloatArray(n) { rnd.nextFloat() * 2 - 1 }
    val re = DoubleArray(n / 2 + 1)
    val im = DoubleArray(n / 2 + 1)
    val fft = RealFft(n)
    fft.forward(x, re, im)
    val y = FloatArray(n)
    fft.inverse(re, im, y)
    assertArrayEquals(x, y, 1e-5f)
  }

  @Test
  fun stftRoundTripDelaysByOneHop() {
    // Değiştirilmemiş spektrum geri dönüştürülünce çıkış girişin tam bir atlama (10 ms) gecikmiş hâli olmalı
    val framer = StftFramer()
    val spec = FloatArray(Dpdfnet.BINS * 2)
    val rnd = Random(11)
    val frames = 20
    val input = Array(frames) { FloatArray(Dpdfnet.HOP) { rnd.nextFloat() - 0.5f } }
    val out = FloatArray(Dpdfnet.HOP)
    var maxErr = 0f
    for (t in 0 until frames) {
      framer.analyze(input[t], spec)
      framer.synthesize(spec, out)
      if (t > 0) {
        for (i in 0 until Dpdfnet.HOP) maxErr = maxOf(maxErr, abs(out[i] - input[t - 1][i]))
      }
    }
    assertTrue("en büyük hata $maxErr", maxErr < 1e-5f)
  }

  @Test
  fun vorbisWindowIsPowerComplementary() {
    val w = Dpdfnet.vorbisWindow(Dpdfnet.WIN)
    for (i in 0 until Dpdfnet.HOP) {
      assertEquals(1.0, (w[i] * w[i] + w[i + Dpdfnet.HOP] * w[i + Dpdfnet.HOP]).toDouble(), 1e-6)
    }
  }

  @Test
  fun attenuationLimit() {
    assertEquals(0f, Dpdfnet.attenLimitAlpha(100.0), 0f)
    assertEquals(0.0631f, Dpdfnet.attenLimitAlpha(24.0), 1e-4f)
    assertEquals(0.2512f, Dpdfnet.attenLimitAlpha(12.0), 1e-4f)
  }

  @Test
  fun initialStateFromMetadata() {
    val state = Dpdfnet.initialState(
      mapOf(
        "state_size" to "8",
        "erb_norm_state_size" to "2",
        "spec_norm_state_size" to "3",
        "erb_norm_init" to "-32.5,-34.25",
        "spec_norm_init" to "0.5,0.25,0.125",
      ),
    )
    assertArrayEquals(floatArrayOf(-32.5f, -34.25f, 0.5f, 0.25f, 0.125f, 0f, 0f, 0f), state, 0f)
  }
}
