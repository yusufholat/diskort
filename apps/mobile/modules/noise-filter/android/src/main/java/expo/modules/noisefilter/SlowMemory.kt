package expo.modules.noisefilter

import android.content.Context
import android.os.Build
import android.os.PowerManager

/**
 * DPDFNet'in bu telefonda yetişemediğinin kalıcı kaydı: sonraki katılışlarda ve uygulama açılışlarında model hiç
 * yüklenmeden doğrudan WebRTC'nin standart gürültü engellemesine geçilir (her seferinde sesi bozarak yeniden
 * denenmez). Kayıt telefon modeline ve yüklü APK'ya bağlıdır (sürüm kodu + kurulum anı): yeni APK
 * kurulunca (model ya da ayarlar değişmiş olabilir) bir kez daha denenir.
 *
 * Genel yavaşlık (ortalama bütçeyi aşıyor) hemen kaydedilir; ani takılmalar ikinci kez olursa. Telefon
 * pil tasarrufundaysa ya da ısınmışsa (işlemci kısılır) yavaşlık geçici sayılır, kaydedilmez.
 */
internal class SlowMemory(private val app: Context) {
  private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Bu telefon + bu APK (+ model ve kural sürümü) */
  private val identity: String by lazy {
    "${Build.MANUFACTURER} ${Build.MODEL}|${apkVersion()}|$RULES"
  }

  /** Kayıtlı neden (bu telefonda ve bu APK'da yetişemedi); yoksa null */
  fun reason(): String? =
    try {
      if (prefs.getString(KEY_ID, null) == identity) prefs.getString(KEY_REASON, null) else null
    } catch (_: Throwable) {
      null
    }

  /**
   * Yetişemedi: kaydeder (genel yavaşlıkta hemen, ani takılmada ikinci kezde). Kalıcı kayıt yapıldıysa
   * true. Geçici koşulda (pil tasarrufu, ısınma) hiçbir şey yazılmaz.
   */
  fun record(miss: DpdfnetBudget.Miss): Boolean =
    try {
      if (transient()) {
        false
      } else {
        val same = prefs.getString(KEY_ID, null) == identity
        val strikes = (if (same) prefs.getInt(KEY_STRIKES, 0) else 0) + 1
        val remember = miss.systematic || strikes >= 2
        val edit = prefs.edit().putString(KEY_ID, identity).putInt(KEY_STRIKES, strikes)
        if (remember) edit.putString(KEY_REASON, miss.reason) else if (!same) edit.remove(KEY_REASON)
        edit.apply()
        remember
      }
    } catch (_: Throwable) {
      false
    }

  /** Pil tasarrufu ya da ısınma: işlemci kısılmış olabilir, ölçüm telefonun gerçek hızını göstermez */
  private fun transient(): Boolean {
    val power = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    if (power.isPowerSaveMode) return true
    return Thermal.status(app) >= Thermal.MODERATE
  }

  @Suppress("DEPRECATION")
  private fun apkVersion(): String =
    try {
      val info = app.packageManager.getPackageInfo(app.packageName, 0)
      val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
      "${info.versionName} ($code) ${info.lastUpdateTime}"
    } catch (_: Throwable) {
      ""
    }

  private companion object {
    const val PREFS = "diskort_dpdfnet"
    const val KEY_ID = "slowId"
    const val KEY_REASON = "slowReason"
    const val KEY_STRIKES = "slowStrikes"

    /** Karar kuralları değişince eski kayıtlar geçersiz olsun (sürüm kodu değişmese de) */
    const val RULES = "dpdfnet2_48khz_hr_int8/1"
  }
}
