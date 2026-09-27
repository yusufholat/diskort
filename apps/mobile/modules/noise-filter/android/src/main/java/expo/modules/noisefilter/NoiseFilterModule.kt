package expo.modules.noisefilter

import android.os.Build
import android.util.Log
import com.livekit.reactnative.LiveKitReactNative
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * DPDFNet gürültü engelleme (JS: modules/noise-filter). Model APK'nın içindedir (assets); ONNX Runtime
 * ile telefonda çalışır. Model sesli sohbete katılırken yüklenir, ayrılırken bellekten atılır.
 */
class NoiseFilterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DiskortNoiseFilter")

    /** İşlemci kendini devre dışı bıraktı: { reason } */
    Events("onBypass")

    OnCreate {
      PerfHint.context = appContext.reactContext?.applicationContext
      DpdfnetProcessor.onBypass = { reason ->
        Log.w(TAG, "DPDFNet devre dışı: $reason")
        sendEvent("onBypass", mapOf("reason" to reason))
      }
    }

    OnDestroy {
      DpdfnetProcessor.onBypass = null
    }

    /** Bu telefonda denenebilir mi (32/64 bit ARM; emülatörde ONNX Runtime kütüphanesi paketlenmiyor) */
    Function("isSupported") {
      Build.SUPPORTED_ABIS.any { it == "arm64-v8a" || it == "armeabi-v7a" }
    }

    /**
     * Açar ya da kapatır. Açarken model yüklenir, hızı ölçülür ve WebRTC'ye takılır. Sonuç: durum
     * (getStats ile aynı alanlar); active false ise reason neden çalışmadığını söyler.
     */
    AsyncFunction("configure") { enabled: Boolean, attenLimitDb: Double ->
      if (!enabled) {
        DpdfnetProcessor.setEnabled(false)
        DpdfnetProcessor.install(null)
        return@AsyncFunction status(null)
      }
      DpdfnetProcessor.slowReason?.let { return@AsyncFunction status(it) }
      try {
        if (!DpdfnetProcessor.hasEngine()) {
          val context = appContext.reactContext ?: return@AsyncFunction status("uygulama bağlamı yok")
          val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
          var engine: DpdfnetEngine? = load(bytes, attenLimitDb, xnnpack = false)
          var warm = DpdfnetProcessor.warmUp(engine!!)
          log(warm)
          if (warm.avgMs > DpdfnetProcessor.BUDGET_MS) {
            // Son şans: XNNPACK (Conv düğümleri başka çekirdeklerle). ARM64 büyük çekirdekte (Neoverse N2)
            // CPU'dan hızlı değildi, o yüzden varsayılan değil; yalnızca CPU yetişemeyen telefonda denenir.
            engine.close()
            engine = try {
              load(bytes, attenLimitDb, xnnpack = true)
            } catch (t: Throwable) {
              Log.w(TAG, "XNNPACK açılamadı", t)
              null
            }
            if (engine != null) {
              val alt = DpdfnetProcessor.warmUp(engine)
              log(alt)
              if (alt.avgMs < warm.avgMs) warm = alt
              if (alt.avgMs > DpdfnetProcessor.BUDGET_MS) {
                engine.close()
                engine = null
              }
            }
          }
          DpdfnetProcessor.warmup = warm
          if (engine == null) {
            val reason = String.format("yavaş: kare başına %.1f ms", warm.avgMs)
            DpdfnetProcessor.slowReason = reason
            return@AsyncFunction status(reason)
          }
          DpdfnetProcessor.install(engine)
        } else {
          DpdfnetProcessor.setAttenLimit(attenLimitDb)
        }
        val controller = try {
          LiveKitReactNative.audioProcessingController
        } catch (_: IllegalStateException) {
          null
        } ?: return@AsyncFunction status("WebRTC ses işleme hazır değil")
        if (controller.capturePostProcessor !== DpdfnetProcessor) {
          controller.capturePostProcessor = DpdfnetProcessor
        }
        DpdfnetProcessor.setEnabled(true)
        status(null)
      } catch (t: Throwable) {
        Log.e(TAG, "DPDFNet yüklenemedi", t)
        DpdfnetProcessor.setEnabled(false)
        DpdfnetProcessor.install(null)
        status("yüklenemedi: ${t.message ?: t.javaClass.simpleName}")
      }
    }

    /** Bastırma sınırı (dB); 100 = sınırsız. Anında uygulanır. */
    Function("setAttenLimit") { db: Double ->
      DpdfnetProcessor.setAttenLimit(db)
    }

    /** Anlık durum ve son 2 saniyenin ölçümleri */
    Function("getStats") {
      status(null)
    }
  }

  private fun load(bytes: ByteArray, attenLimitDb: Double, xnnpack: Boolean): DpdfnetEngine {
    val start = System.nanoTime()
    val engine = DpdfnetEngine.create(bytes, attenLimitDb, xnnpack)
    Log.i(TAG, String.format("DPDFNet yüklendi (%s): %.0f ms", engine.provider, (System.nanoTime() - start) / 1e6))
    return engine
  }

  private fun log(w: DpdfnetProcessor.WarmUp) {
    Log.i(
      TAG,
      String.format(
        "DPDFNet ısınma (%s): kare başına %.2f ms (model %.2f, ilk yarı %.2f; çekirdek %s; ipucu %b)",
        w.provider, w.avgMs, w.modelMs, w.firstMs, w.core, w.hint,
      ),
    )
  }

  private fun status(reason: String?): Map<String, Any?> {
    val s = DpdfnetProcessor.stats
    val w = DpdfnetProcessor.warmup
    val tid = DpdfnetProcessor.audioTid
    return mapOf(
      "active" to (reason == null && DpdfnetProcessor.isActive()),
      "processing" to (DpdfnetProcessor.isActive() && DpdfnetProcessor.isProcessing()),
      "reason" to (reason ?: DpdfnetProcessor.bypassReason ?: DpdfnetProcessor.slowReason),
      "sampleRate" to DpdfnetProcessor.sampleRate,
      "warmupMs" to (w?.avgMs ?: 0.0),
      "warmupModelMs" to w?.modelMs,
      "warmupFirstMs" to w?.firstMs,
      "warmupCore" to w?.core,
      "provider" to (DpdfnetProcessor.provider ?: w?.provider),
      // Başarım ipucu (ADPF): ses iş parçacığında (canlı) ya da ısınmada açıldı mı
      "hint" to (if (DpdfnetProcessor.audioTid != 0) DpdfnetProcessor.hintActive else w?.hint),
      "avgMs" to s?.avgMs,
      "modelMs" to s?.modelMs,
      "maxMs" to s?.maxMs,
      "load" to s?.load,
      "frames" to (s?.frames ?: 0L).toDouble(),
      "overHop" to (s?.overHop ?: 0),
      "audioCore" to (if (tid != 0) CpuInfo.describe(tid) else null),
      "cpu" to CpuInfo.clusters,
      "soc" to (if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}" else Build.HARDWARE),
    )
  }

  private companion object {
    const val TAG = "DiskortNoiseFilter"
    const val MODEL_ASSET = "dpdfnet2_48khz_hr_int8.onnx"
  }
}
