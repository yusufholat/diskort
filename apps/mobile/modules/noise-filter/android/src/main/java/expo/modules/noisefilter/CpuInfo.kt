package expo.modules.noisefilter

import java.io.File

/**
 * Tanılama: bir iş parçacığının son çalıştığı çekirdek ve çekirdeklerin en yüksek frekansları. Büyük/küçük
 * çekirdekli telefonlarda ses iş parçacığı küçük çekirdeğe düşerse model 3–4 kat yavaş çalışır; saha
 * raporunda bunu ayırt etmek için. Okunamazsa (SELinux vb.) null.
 */
object CpuInfo {
  /** /proc/self/task/<tid>/stat'ın 39. alanı: son çalıştığı çekirdek */
  fun coreOf(tid: Int): Int? = try {
    val stat = File("/proc/self/task/$tid/stat").readText()
    // 2. alan (ad) boşluk ve parantez içerebilir: son ')' sonrasından say (3. alandan başlar)
    stat.substring(stat.lastIndexOf(')') + 2).split(' ').getOrNull(39 - 3)?.toIntOrNull()
  } catch (_: Throwable) {
    null
  }

  /** Çekirdeğin en yüksek frekansı (MHz) */
  fun maxMhz(core: Int): Int? = try {
    File("/sys/devices/system/cpu/cpu$core/cpufreq/cpuinfo_max_freq").readText().trim().toInt() / 1000
  } catch (_: Throwable) {
    null
  }

  /** Çekirdek kümeleri, ör. "6×2000 + 2×2600 MHz" (okunamazsa çekirdek sayısı) */
  val clusters: String by lazy {
    val n = Runtime.getRuntime().availableProcessors()
    val freqs = (0 until n).map { maxMhz(it) }
    if (freqs.any { it == null }) {
      "$n çekirdek"
    } else {
      freqs.groupingBy { it!! }.eachCount().toSortedMap().entries.joinToString(" + ") { "${it.value}×${it.key}" } + " MHz"
    }
  }

  /** Çekirdek ve frekansı, ör. "7 (2600 MHz)" */
  fun describe(tid: Int): String? {
    val core = coreOf(tid) ?: return null
    return maxMhz(core)?.let { "$core ($it MHz)" } ?: core.toString()
  }
}
