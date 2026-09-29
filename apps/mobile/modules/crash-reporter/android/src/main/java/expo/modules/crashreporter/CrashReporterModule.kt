package expo.modules.crashreporter

import android.app.Application
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Yerel çökme raporları (JS: modules/crash-reporter, src/crashReports.ts). Ayrıntılar CrashStore'da. */
class CrashReporterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DiskortCrashReporter")

    OnCreate {
      // İşleyici normalde açılışta kurulur (CrashReporterPackage); bağlanamadıysa en azından buradan
      (appContext.reactContext?.applicationContext as? Application)?.let { CrashStore.install(it) }
    }

    /** Çökme raporuna eklenecek JavaScript bağlamı (sürüm, güncelleme, ekran). Ucuz: ekran değiştikçe çağrılır. */
    Function("setCrashContext") { info: String ->
      CrashStore.setContext(info)
    }

    /** Önceki çalıştırmalardan bekleyen raporlar (her biri JSON metni); okunanlar silinir */
    AsyncFunction("takePendingCrashes") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction emptyList<String>()
      CrashStore.takePending(context)
    }
  }
}
