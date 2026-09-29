package expo.modules.noisefilter

/**
 * DPDFNet'in zaman bütçesi: telefon modeli gerçek zamanda, sesi bozmadan çalıştırabilir mi (saf; Android'e
 * bağlı değil, JVM testi: DpdfnetBudgetTest).
 *
 * Saha verisi (HONOR, Snapdragon 7 Gen 3 / SM7550, 4×1804 + 3×2400 + 1×2630 MHz): ısınma 4,00 ms/kare ile
 * geçti (eski sınır 6 ms), canlıda ise ortalama 6,0–6,3 ms, en uzun kare 13,3 ms, ses iş parçacığı yükü
 * ~%63–76 oldu; iki yönde de cızırtı vardı. Canlı maliyet ısınmanın ~1,5–1,6 katı: ısınmada kareler arka
 * arkaya işlenir (işlemci yüksek frekansta, önbellek sıcak); canlıda ise 10 ms'de bir gelen kısa iş vardır,
 * zamanlayıcı frekansı düşürür ve kareler arasında önbellek soğur. Ses iş parçacığında modelden başka
 * WebRTC'nin kendi işlemleri (yankı engelleme, kazanç, JNI) de çalışır; bu yüzden canlı sınır 10 ms'nin
 * yarısı, ısınma sınırı da bunun 1,6'da biri: SM7550 gibi sınırdaki telefonlar artık baştan standart
 * gürültü engellemeyle başlar.
 */
object DpdfnetBudget {
  /** Kare (hop) süresi: 48 kHz'de 480 örnek */
  const val HOP_MS = 10.0

  /** Canlıda 2 saniyelik pencerenin ortalama kare süresi sınırı (10 ms'nin %50'si); SM7550'de 6 ms'de ses bozuldu */
  const val LIVE_BUDGET_MS = 5.0

  /** Canlı / ısınma kare süresi oranı (SM7550: 6,0–6,3 / 4,00; üst taraftan) */
  const val LIVE_FACTOR = 1.6

  /** Isınmanın (ikinci yarı) ortalama sınırı: canlıda 1,6 katıyla bütçeye sığmalı (5,0 / 1,6 ≈ 3,1 ms) */
  const val WARMUP_BUDGET_MS = LIVE_BUDGET_MS / LIVE_FACTOR

  /**
   * Isınmanın ikinci yarısındaki ikinci en uzun kare: canlıda 1,6 katıyla 10 ms'ye dayanmamalı (6 × 1,6 = 9,6).
   * En uzun kare değil: tek bir kez iş parçacığı başka işe bırakıldıysa hızlı telefon elenmesin.
   */
  const val WARMUP_SPIKE_MS = 6.0

  /**
   * Isınmanın ilk yarısı (ilk kare hariç; işlemci henüz hızlanmamış, kod ısınıyor): 10 ms'ye yaklaşıyorsa
   * telefon ancak tam hızda yetişiyor demektir; canlıda o hız tutmaz.
   */
  const val WARMUP_FIRST_MS = 8.0

  /**
   * Canlıda bir pencerede 10 ms'yi aşan karelerin en fazla oranı (%): üstü sesin kesilmesi demektir.
   * 2 saniyede ~200 kare: 3 ve üstü kare yetişemedi.
   */
  const val OVER_HOP_PERCENT = 1

  /**
   * Yetişemedi kararı. systematic: telefon genel olarak yavaş (ortalama bütçeyi aşıyor); değilse ani
   * takılmalardır (ör. anlık başka yük). Isınmada ani takılma kararı ancak ikinci ölçümde de görülürse
   * verilir ve bu açılışta bile akılda tutulmaz. Kalıcı kayıt: SlowMemory.
   */
  data class Miss(val reason: String, val systematic: Boolean)

  /**
   * Isınma ölçümünün kararı (ms/kare): avgMs ikinci yarının ortalaması, spikeMs ikinci yarının ikinci en uzun
   * karesi, firstMs ilk yarının ortalaması. null: yetişiyor.
   */
  fun judgeWarmUp(avgMs: Double, spikeMs: Double, firstMs: Double): Miss? {
    if (avgMs > WARMUP_BUDGET_MS) return Miss(String.format("yavaş: ısınmada kare başına %.1f ms", avgMs), true)
    if (spikeMs > WARMUP_SPIKE_MS) return Miss(String.format("yavaş: ısınmada uzun kareler (%.1f ms)", spikeMs), false)
    if (firstMs > WARMUP_FIRST_MS) {
      return Miss(String.format("yavaş: ısınmanın ilk yarısında kare başına %.1f ms", firstMs), false)
    }
    return null
  }

  /**
   * Isınma ortalaması canlı bütçeyi bile aşıyor: canlıda hiç yetişemez, bu telefonda ve bu APK'da hemen kalıcı
   * olarak kaydedilir. Aradaki ısınmalar (3,1–5 ms) yalnızca bu açılışta akılda tutulur.
   */
  fun rememberWarmUp(avgMs: Double): Boolean = avgMs > LIVE_BUDGET_MS

  /**
   * Canlıda bir ölçüm penceresinin kararı: ortalama bütçeyi aşıyor ya da karelerin %1'inden fazlası 10 ms'yi
   * geçiyor (gerçek zamanı kaçırdı). null: yetişiyor. Tek pencere bu oturumda kapatmaya yeter; kalıcı kayıt
   * için 7 gün içinde ikinci kez olmalı (SlowMemory.strike).
   */
  fun judgeWindow(avgMs: Double, overHop: Int, frames: Int): Miss? {
    if (frames <= 0) return null
    if (avgMs > LIVE_BUDGET_MS) return Miss(String.format("yavaş: kare başına %.1f ms", avgMs), true)
    if (overHop * 100 > frames * OVER_HOP_PERCENT) {
      return Miss("yetişemedi: $frames karenin $overHop tanesi 10 ms'yi aştı", false)
    }
    return null
  }
}
