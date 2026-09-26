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
      appContext.reactContext?.let { context ->
        val intent = Intent(context, VoiceForegroundService::class.java).apply {
          action = VoiceForegroundService.ACTION_SHOW
          putExtra("title", title)
          putExtra("text", text)
          putExtra("muted", muted)
        }
        ContextCompat.startForegroundService(context, intent)
      }
      Unit
    }

    /** Bildirimi günceller (ör. susturma durumu değişince); arka planda da çağrılabilir. */
    Function("update") { title: String, text: String, muted: Boolean ->
      appContext.reactContext?.let { context -> VoiceForegroundService.update(context, title, text, muted) }
      Unit
    }

    Function("stop") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, VoiceForegroundService::class.java))
      }
      Unit
    }
  }
}
