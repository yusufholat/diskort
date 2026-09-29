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
 * frekansı hedefe göre ayarlar.
 *
 * Güvenlik (eşikler: DpdfnetBudget): 2 saniyelik bir ölçüm penceresinde ortalama kare süresi bütçeyi aşarsa
 * ya da kareler gerçek zamanı (10 ms) kaçırırsa, hata olursa ya da telefon çok ısınırsa işlemci kendini
 * devre dışı bırakır (ses olduğu gibi geçer) ve bildirir; modül motoru kapatır, JS de WebRTC'nin kendi
 * gürültü engellemesini açar. Açılıştaki ilk pencere karar vermez (iş parçacığı ve ipucu yeni başlıyor).
 * 48 kHz dışındaki hızlarda ses işlenmeden geçer.
 */
object DpdfnetProcessor : AudioProcessorInterface {
  private const val WINDOW_MS = 2000L
  private const val SCALE = 32768f

  /** Bu kadar kare gelmezse (mikrofon kapalıydı) ölçüm baştan başlar */
  private const val PAUSE_MS = 1000L

  private val lock = ReentrantLock()
  private val bypassLock = Any()
  private var engine: DpdfnetEngine? = null

  @Volatile
  private var enabled = false

  @Volatile
  private var needsReset = false

  /** Devre dışı kalma nedeni (null: çalışıyor); yalnızca yeni yüklemede ya da kapatınca silinir */
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

  enum class Kind {
    /** Telefon genel olarak yavaş (ortalama bütçeyi aşıyor) */
    SLOW,

    /** Ani takılmalar: kareler 10 ms'yi aştı */
    SPIKE,

    /** Model hata verdi */
    ERROR,

    /** Telefon çok ısındı (yalnızca bu oturum) */
    THERMAL,
  }

  /** Devre dışı kalma: neden, türü ve o anki motor (modül ses iş parçacığı dışında kapatır) */
  class Bypass(val reason: String, val kind: Kind, val engine: DpdfnetEngine?)

  /** Devre dışı kalınca çağrılır; ses iş parçacığında (kilit tutulurken) olabilir: uzun iş yapmamalı */
  @Volatile
  var onBypass: ((Bypass) -> Unit)? = null

  private val hop = FloatArray(Dpdfnet.HOP)
  private val out = FloatArray(Dpdfnet.HOP)

  // Ölçüm penceresi (yalnızca ses iş parçacığı yazar)
  private var winStart = 0L
  private var winFrames = 0
  private var winBusyNs = 0L
  private var winModelNs = 0L
  private var winMaxNs = 0L
  private var winOverHop = 0

  /** Açılıştan (ya da aradan) beri biten pencereler: ilki karar vermez */
  private var windows = 0
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
   * Isınma ölçümü (ms/kare). avgMs ikinci yarının ortalaması, maxMs ikinci yarının en uzun karesi; firstMs
   * ilk yarınınki (ilk kare hariç; ikinci yarıdan çok yüksekse işlemci frekansı ısınma sırasında yükseliyordu);
   * modelMs ikinci yarıda modelin payı. Karar: DpdfnetBudget.judgeWarmUp.
   */
  data class WarmUp(
    val avgMs: Double,
    val modelMs: Double,
    val firstMs: Double,
    val maxMs: Double,
    val provider: String,
    /** Isınmanın bittiği çekirdek, ör. "7 (2600 MHz)" */
    val core: String?,
    /** Başarım ipucu (ADPF) kullanıldı mı */
    val hint: Boolean,
  ) {
    fun judge(): DpdfnetBudget.Miss? = DpdfnetBudget.judgeWarmUp(avgMs, maxMs, firstMs)
  }

  /** Motoru takar (öncekini kapatır). Yeni motorla ölçümler ve bypass durumu sıfırlanır. */
  fun install(next: DpdfnetEngine?) {
    val previous = lock.withLock {
      val old = engine
      engine = next
      if (next != null) provider = next.provider
      needsReset = true
      bypassReason = null
      winStart = 0
      windows = 0
      stats = null
      old
    }
    previous?.close()
  }

  /**
   * Devre dışı kaldıktan sonra (ses iş parçacığı dışında): motor kapatılır ve bellekten atılır; neden ve son
   * ölçümler durum için kalır. Bu arada motor değiştiyse (ayrılıp yeniden katılındı) dokunulmaz.
   */
  fun unload(expected: DpdfnetEngine) {
    val closing = lock.withLock {
      if (engine !== expected || bypassReason == null) return
      enabled = false
      engine = null
      expected
    }
    closing.close()
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

  /** Telefon çok ısındı: çalışıyorsa bu oturum için devre dışı kalır (kalıcı kaydedilmez) */
  fun bypassThermal(reason: String) {
    if (!enabled || bypassReason != null) return
    val e = lock.withLock { engine } ?: return
    bypass(Bypass(reason, Kind.THERMAL, e))
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
    if (!enabled || bypassReason != null) {
      // Devre dışı: ses iş parçacığının başarım ipucu kapatılır (sistem frekansı boşuna yüksek tutmasın)
      if (hintTid != 0) {
        hint.close()
        hint = PerfHint.NONE
        hintTid = 0
      }
      return
    }
    // Model yalnızca 48 kHz (10 ms = 480 örnek); diğer hızlarda ses olduğu gibi geçer
    if (numFrames != Dpdfnet.HOP) return
    // Motor değiştiriliyorsa bu kare işlenmeden geçer (ses iş parçacığı beklemez)
    if (!lock.tryLock()) return
    try {
      val e = engine ?: return
      if (needsReset) {
        e.reset()
        needsReset = false
        winStart = 0
        windows = 0
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
      try {
        e.processHop(hop, out)
      } catch (t: Throwable) {
        bypass(Bypass("hata: ${t.message ?: t.javaClass.simpleName}", Kind.ERROR, e))
        return
      }
      val took = System.nanoTime() - start
      hint.report(took)
      for (i in 0 until Dpdfnet.HOP) out[i] *= SCALE
      fb.position(0)
      fb.put(out, 0, Dpdfnet.HOP)
      measure(took, e.lastModelNs, e)
    } catch (t: Throwable) {
      bypass(Bypass("hata: ${t.message ?: t.javaClass.simpleName}", Kind.ERROR, engine))
    } finally {
      lock.unlock()
    }
  }

  private fun measure(tookNs: Long, modelNs: Long, e: DpdfnetEngine) {
    val now = SystemClock.elapsedRealtime()
    // Uzun ara (mikrofon kapalıydı): ölçüm baştan başlar, ilk pencere yine karar vermez
    if (lastFrameAt != 0L && now - lastFrameAt > PAUSE_MS) {
      winStart = 0
      windows = 0
    }
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
    winStart = 0
    windows++
    // İlk pencere (iş parçacığının ilk kareleri, ipucu oturumu yeni) karar vermez; sonrakilerde tek pencere yeter
    if (windows < 2) return
    val miss = DpdfnetBudget.judgeWindow(avgMs, winOverHop, winFrames) ?: return
    slowReason = miss.reason
    bypass(Bypass(miss.reason, if (miss.systematic) Kind.SLOW else Kind.SPIKE, e))
  }

  private fun bypass(b: Bypass) {
    synchronized(bypassLock) {
      if (bypassReason != null) return
      bypassReason = b.reason
    }
    try {
      onBypass?.invoke(b)
    } catch (_: Throwable) {
      // bildirim başarısızsa ses yine de olduğu gibi geçer
    }
  }

  /**
   * Isınma ve hız ölçümü: canlı sesten önce çok kısık rastgele gürültüyle 40 kare çalıştırır; karar ikinci
   * yarıya göre verilir (ilk yarı JIT/önbellek ısınması). Motor ardından temiz duruma alınır.
   */
  fun warmUp(e: DpdfnetEngine): WarmUp {
    val h = FloatArray(Dpdfnet.HOP)
    val o = FloatArray(Dpdfnet.HOP)
    val warmHint = PerfHint.forCurrentThread()
    var seed = 1L
    var first = 0L
    var total = 0L
    var model = 0L
    var max = 0L
    val frames = 40
    val half = frames / 2
    for (f in 0 until frames) {
      for (i in h.indices) {
        seed = (seed * 1664525L + 1013904223L) and 0xffffffffL
        h[i] = ((seed.toDouble() / 4294967296.0 - 0.5) * 1e-3).toFloat()
      }
      val s = System.nanoTime()
      e.processHop(h, o)
      val took = System.nanoTime() - s
      warmHint.report(took)
      if (f >= half) {
        total += took
        model += e.lastModelNs
        if (took > max) max = took
      } else if (f > 0) {
        // İlk kare (bellek ayırma, ilk çalıştırma) sayılmaz
        first += took
      }
    }
    warmHint.close()
    e.reset()
    val core = CpuInfo.describe(android.os.Process.myTid())
    return WarmUp(
      avgMs = total / 1e6 / half,
      modelMs = model / 1e6 / half,
      firstMs = first / 1e6 / (half - 1),
      maxMs = max / 1e6,
      provider = e.provider,
      core = core,
      hint = warmHint.active,
    )
  }
}
