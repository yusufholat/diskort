package expo.modules.crashreporter

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Çökme işleyicisini uygulama açılırken kurar (Application.onCreate: ilk ekrandan ve JavaScript'ten önce).
 * Expo'nun otomatik bağlaması bu sınıfı dosya adından (…Package.kt) ve Package içe aktarımından bulur.
 */
class CrashReporterPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          CrashStore.install(application)
        }
      }
    )
}
