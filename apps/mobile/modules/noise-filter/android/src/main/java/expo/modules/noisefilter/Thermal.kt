package expo.modules.noisefilter

import android.annotation.TargetApi
import android.content.Context
import android.os.Build
import android.os.PowerManager
import java.util.concurrent.Executor

/**
 * Telefonun ısı durumu (PowerManager, Android 10+): 0 yok, 1 hafif, 2 orta, 3 ciddi, 4 kritik, 5 acil,
 * 6 kapanıyor; eski Android'de -1. Isınma payı (headroom, Android 11+): 1,0 "ciddi" eşiği; desteklenmiyorsa
 * ya da çok sık sorulursa null.
 */
object Thermal {
  const val UNKNOWN = -1
  const val LIGHT = 1
  const val SEVERE = 3

  fun status(context: Context): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return UNKNOWN
    return try {
      power(context)?.currentThermalStatus ?: UNKNOWN
    } catch (_: Throwable) {
      UNKNOWN
    }
  }

  /** Şu anki ısınma payı (0: soğuk … 1: ciddi eşiği); Android 11 öncesinde ya da ölçülemezse null */
  fun headroom(context: Context): Double? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    return try {
      val value = headroomR(context) ?: return null
      if (value.isNaN() || value < 0f) null else value.toDouble()
    } catch (_: Throwable) {
      null
    }
  }

  /** Isı durumu değişince çağrılır (Android 10+; kayıtta bir kez şu anki durumla). Dönen işlev dinlemeyi bırakır. */
  fun listen(context: Context, executor: Executor, onChange: (Int) -> Unit): (() -> Unit)? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return try {
      listenQ(context, executor, onChange)
    } catch (_: Throwable) {
      null
    }
  }

  private fun power(context: Context): PowerManager? = context.getSystemService(Context.POWER_SERVICE) as? PowerManager

  @TargetApi(Build.VERSION_CODES.R)
  private fun headroomR(context: Context): Float? = power(context)?.getThermalHeadroom(0)

  @TargetApi(Build.VERSION_CODES.Q)
  private fun listenQ(context: Context, executor: Executor, onChange: (Int) -> Unit): (() -> Unit)? {
    val manager = power(context) ?: return null
    val listener = PowerManager.OnThermalStatusChangedListener { status -> onChange(status) }
    manager.addThermalStatusListener(executor, listener)
    return {
      try {
        manager.removeThermalStatusListener(listener)
      } catch (_: Throwable) {
      }
    }
  }
}
