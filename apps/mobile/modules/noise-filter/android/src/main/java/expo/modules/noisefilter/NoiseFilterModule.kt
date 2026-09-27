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
          val loadStart = System.nanoTime()
          val engine = DpdfnetEngine.create(bytes, attenLimitDb)
          val loadMs = (System.nanoTime() - loadStart) / 1e6
          val warm = DpdfnetProcessor.warmUp(engine)
          Log.i(TAG, String.format("DPDFNet yüklendi (%.0f ms), ısınma: kare başına %.2f ms", loadMs, warm))
          DpdfnetProcessor.warmupMs = warm
          if (warm > DpdfnetProcessor.BUDGET_MS) {
            engine.close()
            val reason = String.format("yavaş: kare başına %.1f ms", warm)
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

  private fun status(reason: String?): Map<String, Any?> {
    val s = DpdfnetProcessor.stats
    return mapOf(
      "active" to (reason == null && DpdfnetProcessor.isActive()),
      "processing" to (DpdfnetProcessor.isActive() && DpdfnetProcessor.isProcessing()),
      "reason" to (reason ?: DpdfnetProcessor.bypassReason),
      "sampleRate" to DpdfnetProcessor.sampleRate,
      "warmupMs" to DpdfnetProcessor.warmupMs,
      "avgMs" to s?.avgMs,
      "maxMs" to s?.maxMs,
      "load" to s?.load,
      "frames" to (s?.frames ?: 0L).toDouble(),
      "overHop" to (s?.overHop ?: 0),
    )
  }

  private companion object {
    const val TAG = "DiskortNoiseFilter"
    const val MODEL_ASSET = "dpdfnet2_48khz_hr.onnx"
  }
}
