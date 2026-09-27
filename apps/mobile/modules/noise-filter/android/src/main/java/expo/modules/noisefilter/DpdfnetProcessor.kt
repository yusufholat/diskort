package expo.modules.noisefilter

import android.os.SystemClock
import com.livekit.reactnative.audio.processing.AudioProcessorInterface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * WebRTC'nin ses işleme modülüne (APM) "yakalama sonrası işlemci" olarak takılan DPDFNet.
 *
 * LiveKit'in Android SDK'sındaki ExternalAudioProcessingFactory, mikrofon sesini APM'nin sonunda
 * (yankı engelleme ve bantların birleştirilmesinden sonra) 10 ms'lik tam bant bloklar hâlinde verir:
 * 48 kHz'de 480 örnek, float, [-32768, 32767] ölçeğinde, yerinde değiştirilir. processAudio WebRTC'nin
 * ses yakalama iş parçacığında çağrılır; model de doğrudan orada çalışır (kare 10 ms, model birkaç ms).
 *
 * Android 12+'da iş parçacığı için başarım ipucu (PerfHint, ADPF) açılır: sistem kare sürelerini görüp
 * frekansı hedefe (5 ms) göre ayarlar.
 *
 * Güvenlik: kare başına ortalama süre gerçek zamanın %60'ını iki ölçüm penceresi üst üste aşarsa ya da
 * hata olursa işlemci kendini devre dışı bırakır (ses olduğu gibi geçer) ve JS'e bildirir; JS de o zaman
 * WebRTC'nin kendi gürültü engellemesini açar. 48 kHz dışındaki hızlarda ses işlenmeden geçer.
 */
object DpdfnetProcessor : AudioProcessorInterface {
  /** Kare bütçesi: 10 ms'nin %60'ı */
  const val BUDGET_MS = 6.0
  private const val WINDOW_MS = 2000L
  private const val SCALE = 32768f

  private val lock = ReentrantLock()
  private var engine: DpdfnetEngine? = null

  @Volatile
  private var enabled = false

  @Volatile
  private var needsReset = false

  /** Devre dışı kalma nedeni (null: çalışıyor); süreç boyunca kalıcı, yalnızca yeni yüklemede silinir */
  @Volatile
  var bypassReason: String? = null
    private set

  /** Telefon yetişemedi (ısınmada ya da canlıda): uygulama yeniden açılana kadar bir daha denenmez */
  @Volatile
  var slowReason: String? = null

  @Volatile
  var sampleRate = 0
    private set

  /** Son ısınmanın ölçümü (null: henüz yok) */
  @Volatile
  var warmup: WarmUp? = null

  /** Takılı motorun yürütücüsü ("CPU" / "XNNPACK"); motor yoksa son kullanılan */
  @Volatile
  var provider: String? = null
    private set

  /** Ses iş parçacığının kimliği (tid): hangi çekirdekte çalıştığını tanılama için okuruz */
  @Volatile
  var audioTid = 0
    private set

  /** Ses iş parçacığının başarım ipucu oturumu (yalnızca ses iş parçacığı kullanır) */
  private var hint: PerfHint = PerfHint.NONE
  private var hintTid = 0

  /** Ses iş parçacığı için başarım ipucu (ADPF) açık mı */
  @Volatile
  var hintActive = false
    private set

  /** Devre dışı kalınca çağrılır (neden) */
  @Volatile
  var onBypass: ((String) -> Unit)? = null

  private val hop = FloatArray(Dpdfnet.HOP)
  private val out = FloatArray(Dpdfnet.HOP)

  // Ölçüm penceresi (yalnızca ses iş parçacığı yazar)
  private var winStart = 0L
  private var winFrames = 0
  private var winBusyNs = 0L
  private var winModelNs = 0L
  private var winMaxNs = 0L
  private var winOverHop = 0
  private var strikes = 0
  private var totalFrames = 0L
  private var lastFrameAt = 0L

  /** Son ölçüm penceresinin özeti (JS okur) */
  @Volatile
  var stats: Stats? = null
    private set

  data class Stats(
    val avgMs: Double,
    /** Ortalamanın modele (ONNX Runtime) düşen kısmı; kalanı STFT/ISTFT */
    val modelMs: Double,
    val maxMs: Double,
    val load: Double,
    val frames: Long,
    val overHop: Int,
  )

  /**
   * Isınma ölçümü (ms/kare). avgMs ikinci yarının ortalaması (karar buna göre); firstMs ilk yarınınki
   * (ikisi çok farklıysa işlemci frekansı ısınma sırasında yükseliyordu); modelMs ikinci yarıda modelin payı.
   */
  data class WarmUp(
    val avgMs: Double,
    val modelMs: Double,
    val firstMs: Double,
    val provider: String,
    /** Isınmanın bittiği çekirdek, ör. "7 (2600 MHz)" */
    val core: String?,
    /** Başarım ipucu (ADPF) kullanıldı mı */
    val hint: Boolean,
  )

  /** Motoru takar (öncekini kapatır). Yeni motorla ölçümler ve bypass durumu sıfırlanır. */
  fun install(next: DpdfnetEngine?) {
    val previous = lock.withLock {
      val old = engine
      engine = next
      if (next != null) provider = next.provider
      needsReset = true
      bypassReason = null
      strikes = 0
      winStart = 0
      stats = null
      old
    }
    previous?.close()
  }

  fun hasEngine(): Boolean = lock.withLock { engine != null }

  fun setEnabled(value: Boolean) {
    enabled = value
    if (value) needsReset = true
  }

  fun isActive(): Boolean = enabled && bypassReason == null && hasEngine()

  /** Son 1 saniyede işlenen kare var mı (mikrofon açık ve hız destekleniyor) */
  fun isProcessing(): Boolean = SystemClock.elapsedRealtime() - lastFrameAt < 1000

  fun setAttenLimit(db: Double) {
    lock.withLock { engine?.setAttenLimit(db) }
  }

  override fun isEnabled(): Boolean = enabled

  override fun getName(): String = "diskort_dpdfnet"

  override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) {
    sampleRate = sampleRateHz
    needsReset = true
  }

  override fun resetAudioProcessing(newRate: Int) {
    sampleRate = newRate
    needsReset = true
  }

  override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
    if (!enabled || bypassReason != null) return
    // Model yalnızca 48 kHz (10 ms = 480 örnek); diğer hızlarda ses olduğu gibi geçer
    if (numFrames != Dpdfnet.HOP) return
    // Motor değiştiriliyorsa bu kare işlenmeden geçer (ses iş parçacığı beklemez)
    if (!lock.tryLock()) return
    try {
      val e = engine ?: return
      if (needsReset) {
        e.reset()
        needsReset = false
      }
      val fb = buffer.order(ByteOrder.nativeOrder()).asFloatBuffer()
      if (fb.capacity() < Dpdfnet.HOP) return
      fb.get(hop, 0, Dpdfnet.HOP)
      for (i in 0 until Dpdfnet.HOP) hop[i] /= SCALE
      val tid = android.os.Process.myTid()
      if (tid != hintTid) {
        // İlk kare ya da WebRTC ses iş parçacığını değiştirdi: ipucu oturumu bu iş parçacığı için
        hint.close()
        hint = PerfHint.forCurrentThread()
        hintTid = tid
        hintActive = hint.active
      }
      val start = System.nanoTime()
      e.processHop(hop, out)
      val took = System.nanoTime() - start
      hint.report(took)
      for (i in 0 until Dpdfnet.HOP) out[i] *= SCALE
      fb.position(0)
      fb.put(out, 0, Dpdfnet.HOP)
      measure(took, e.lastModelNs)
    } catch (t: Throwable) {
      bypass("hata: ${t.message ?: t.javaClass.simpleName}")
    } finally {
      lock.unlock()
    }
  }

  private fun measure(tookNs: Long, modelNs: Long) {
    val now = SystemClock.elapsedRealtime()
    lastFrameAt = now
    totalFrames++
    if (winStart == 0L) {
      winStart = now
      audioTid = android.os.Process.myTid()
      winFrames = 0
      winBusyNs = 0
      winModelNs = 0
      winMaxNs = 0
      winOverHop = 0
    }
    winFrames++
    winBusyNs += tookNs
    winModelNs += modelNs
    if (tookNs > winMaxNs) winMaxNs = tookNs
    if (tookNs > 10_000_000L) winOverHop++
    val elapsed = now - winStart
    if (elapsed < WINDOW_MS) return
    val avgMs = winBusyNs / 1e6 / winFrames
    stats = Stats(
      avgMs = avgMs,
      modelMs = winModelNs / 1e6 / winFrames,
      maxMs = winMaxNs / 1e6,
      load = winBusyNs / 1e6 / elapsed,
      frames = totalFrames,
      overHop = winOverHop,
    )
    // Yetişemiyor: ortalama bütçeyi aşıyor ya da karelerin %5'inden fazlası 10 ms'yi geçiyor
    val slow = avgMs > BUDGET_MS || winOverHop * 20 > winFrames
    strikes = if (slow) strikes + 1 else 0
    winStart = 0
    if (strikes >= 2) {
      val reason = String.format("yavaş: kare başına %.1f ms", avgMs)
      slowReason = reason
      bypass(reason)
    }
  }

  private fun bypass(reason: String) {
    if (bypassReason != null) return
    bypassReason = reason
    try {
      onBypass?.invoke(reason)
    } catch (_: Throwable) {
      // bildirim başarısızsa ses yine de olduğu gibi geçer
    }
  }

  /**
   * Isınma ve hız ölçümü: canlı sesten önce çok kısık rastgele gürültüyle 40 kare çalıştırır; karar ikinci
   * yarının ortalamasına göre verilir (ilk yarı JIT/önbellek ısınması). Motor ardından temiz duruma alınır.
   */
  fun warmUp(e: DpdfnetEngine): WarmUp {
    val h = FloatArray(Dpdfnet.HOP)
    val o = FloatArray(Dpdfnet.HOP)
    val warmHint = PerfHint.forCurrentThread()
    var seed = 1L
    var first = 0L
    var total = 0L
    var model = 0L
    val frames = 40
    for (f in 0 until frames) {
      for (i in h.indices) {
        seed = (seed * 1664525L + 1013904223L) and 0xffffffffL
        h[i] = ((seed.toDouble() / 4294967296.0 - 0.5) * 1e-3).toFloat()
      }
      val s = System.nanoTime()
      e.processHop(h, o)
      val took = System.nanoTime() - s
      warmHint.report(took)
      if (f >= frames / 2) {
        total += took
        model += e.lastModelNs
      } else {
        first += took
      }
    }
    warmHint.close()
    e.reset()
    val half = frames / 2
    val core = CpuInfo.describe(android.os.Process.myTid())
    return WarmUp(total / 1e6 / half, model / 1e6 / half, first / 1e6 / half, e.provider, core, warmHint.active)
  }
}
