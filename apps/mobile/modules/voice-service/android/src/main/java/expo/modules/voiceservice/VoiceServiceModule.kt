package expo.modules.voiceservice

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VoiceServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VoiceService")

    /** Bildirim düğmeleri: { action: "toggleMute" | "disconnect" } */
    Events("onAction")

    OnCreate {
      VoiceForegroundService.onAction = { action -> sendEvent("onAction", mapOf("action" to action)) }
    }

    OnDestroy {
      VoiceForegroundService.onAction = null
    }

    /** Servisi başlatır; yalnızca uygulama öndeyken çağrılmalı (sese katılırken). */
    Function("start") { title: String, text: String, muted: Boolean ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, VoiceForegroundService::class.java).apply {
        action = VoiceForegroundService.ACTION_SHOW
        putExtra("title", title)
        putExtra("text", text)
        putExtra("muted", muted)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    /** Bildirimi günceller (ör. susturma durumu değişince); arka planda da çağrılabilir. */
    Function("update") { title: String, text: String, muted: Boolean ->
      val context = appContext.reactContext ?: return@Function
      VoiceForegroundService.update(context, title, text, muted)
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      context.stopService(Intent(context, VoiceForegroundService::class.java))
    }
  }
}
