package expo.modules.voiceservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

/**
 * Sesli sohbet sürerken uygulamayı arka planda (ekran kilitliyken) canlı tutan ön plan servisi.
 * Bildirimde kanal adı, "Sustur" ve "Bağlantıyı kes" düğmeleri bulunur.
 */
class VoiceForegroundService : Service() {
  companion object {
    // Kanal önemi sonradan değiştirilemez; ayar değişince yeni kimlik gerekir (eskisi silinir)
    private const val CHANNEL_ID = "diskort_voice_call"
    private val OLD_CHANNEL_IDS = listOf("diskort_voice")
    const val NOTIFICATION_ID = 4101

    const val ACTION_SHOW = "expo.modules.voiceservice.SHOW"
    const val ACTION_TOGGLE_MUTE = "expo.modules.voiceservice.TOGGLE_MUTE"
    const val ACTION_DISCONNECT = "expo.modules.voiceservice.DISCONNECT"

    /** JS tarafına bildirim düğmelerini iletir (VoiceServiceModule bağlar). */
    @Volatile
    var onAction: ((String) -> Unit)? = null

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      for (old in OLD_CHANNEL_IDS) manager.deleteNotificationChannel(old)
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      // Varsayılan önem (sessiz): düşük önemli bildirimleri birçok telefon kilit ekranında göstermez
      val channel = NotificationChannel(CHANNEL_ID, "Sesli sohbet", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Sesli sohbete bağlıyken gösterilir; kilit ekranından susturabilirsin"
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }

    fun build(context: Context, title: String, text: String, muted: Boolean): Notification {
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      }
      val open = launch?.let { PendingIntent.getActivity(context, 0, it, flags) }
      fun action(name: String, code: Int): PendingIntent =
        PendingIntent.getService(
          context,
          code,
          Intent(context, VoiceForegroundService::class.java).setAction(name),
          flags,
        )

      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.diskort_voice_notification)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(open)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .addAction(0, if (muted) "Susturmayı kaldır" else "Sustur", action(ACTION_TOGGLE_MUTE, 1))
        .addAction(0, "Bağlantıyı kes", action(ACTION_DISCONNECT, 2))
        .build()
    }

    /** Çalışan servisin bildirimini günceller (arka plandayken servis yeniden başlatılamaz). */
    fun update(context: Context, title: String, text: String, muted: Boolean) {
      try {
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, build(context, title, text, muted))
      } catch (_: SecurityException) {
        // Bildirim izni verilmemiş: servis yine çalışır, yalnızca bildirim görünmez
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_TOGGLE_MUTE -> {
        onAction?.invoke("toggleMute")
        return START_NOT_STICKY
      }
      ACTION_DISCONNECT -> {
        onAction?.invoke("disconnect")
        return START_NOT_STICKY
      }
    }

    ensureChannel(this)
    val notification = build(
      this,
      intent?.getStringExtra("title") ?: "Diskort",
      intent?.getStringExtra("text") ?: "Sesli sohbete bağlı",
      intent?.getBooleanExtra("muted", false) ?: false,
    )
    try {
      startAsForeground(notification, withMicrophone = true)
    } catch (_: SecurityException) {
      // Mikrofon izni yoksa (dinleyici olarak bağlı) yalnızca ses çalma türüyle devam et
      startAsForeground(notification, withMicrophone = false)
    }
    return START_NOT_STICKY
  }

  private fun startAsForeground(notification: Notification, withMicrophone: Boolean) {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      if (withMicrophone && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      t
    } else {
      0
    }
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
  }

  /** Uygulama son kullanılanlardan kaydırılıp kapatılınca sesten de çıkılır. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    onAction?.invoke("disconnect")
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }
}
