package expo.modules.noisefilter

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * DPDFNet akışlı gürültü engelleyici (ONNX Runtime Android, CPU, tek iş parçacığı).
 *
 * Kare başına: STFT (Kotlin) → model (onnxruntime) → bastırma sınırı karışımı → ISTFT. Masaüstündeki
 * DpdfnetDenoiser ile aynı matematik. Ses iş parçacığında çalıştığı için kare başına bellek ayırmaz:
 * giriş/çıkış tensörleri doğrudan (direct) tamponlara bağlıdır, model durumu iki tampon arasında
 * gidip gelir (bir karenin çıkış durumu sonrakinin giriş durumu; kopyalama yok).
 *
 * İş parçacığı güvenli değildir: processHop/reset/close aynı anda çağrılmamalı (DpdfnetProcessor kilitler).
 */
class DpdfnetEngine private constructor(
  env: OrtEnvironment,
  private val session: OrtSession,
  private val initState: FloatArray,
  names: Names,
) : AutoCloseable {
  private data class Names(val specIn: String, val stateIn: String, val specOut: String, val stateOut: String)

  private val framer = StftFramer()
  private val spec = FloatArray(Dpdfnet.BINS * 2)
  private val enhanced = FloatArray(Dpdfnet.BINS * 2)
  private val mixed = FloatArray(Dpdfnet.BINS * 2)

  /** Bastırma sınırı karışımı için gürültülü karelerin kısa geçmişi (model gecikmesi kadar) */
  private val history = Array(Dpdfnet.MODEL_LAG_FRAMES + 1) { FloatArray(Dpdfnet.BINS * 2) }
  private var historyPos = 0

  private val specShape = longArrayOf(1, 1, Dpdfnet.BINS.toLong(), 2)
  private val specInBuf = directFloats(Dpdfnet.BINS * 2)
  private val specOutBuf = directFloats(Dpdfnet.BINS * 2)
  private val stateBufs = arrayOf(directFloats(initState.size), directFloats(initState.size))
  private val specInTensor = OnnxTensor.createTensor(env, specInBuf, specShape)
  private val specOutTensor = OnnxTensor.createTensor(env, specOutBuf, specShape)
  private val stateTensors = Array(2) { OnnxTensor.createTensor(env, stateBufs[it], longArrayOf(initState.size.toLong())) }

  /** Durum tamponu `cur` girişte, diğeri çıkışta; her karede yer değiştirirler. */
  private var cur = 0
  private val inputs = Array(2) { i -> mapOf(names.specIn to specInTensor, names.stateIn to stateTensors[i]) }
  private val outputs = Array(2) { i -> mapOf(names.specOut to specOutTensor, names.stateOut to stateTensors[1 - i]) }

  @Volatile
  private var alpha = 0f

  init {
    reset()
  }

  fun setAttenLimit(db: Double) {
    alpha = Dpdfnet.attenLimitAlpha(db)
  }

  /** Temiz durum: STFT tamponları sıfır, model durumu metaverideki başlangıç değerleri. */
  fun reset() {
    framer.reset()
    for (h in history) h.fill(0f)
    historyPos = 0
    cur = 0
    stateBufs[0].position(0)
    stateBufs[0].put(initState)
    stateBufs[0].position(0)
  }

  /** 480 giriş örneği ([-1, 1]) alır, 480 temizlenmiş örnek yazar (ALGORITHMIC_DELAY_SAMPLES gecikmeli). */
  fun processHop(hop: FloatArray, out: FloatArray) {
    framer.analyze(hop, spec)
    System.arraycopy(spec, 0, history[historyPos], 0, spec.size)
    historyPos = (historyPos + 1) % history.size

    specInBuf.position(0)
    specInBuf.put(spec)
    specInBuf.position(0)
    session.run(inputs[cur], outputs[cur]).close()
    cur = 1 - cur
    specOutBuf.position(0)
    specOutBuf.get(enhanced)
    specOutBuf.position(0)

    var result = enhanced
    val a = alpha
    if (a > 0f) {
      // Model çıkışı MODEL_LAG_FRAMES kare geride: aynı anın gürültülü karesiyle karıştır
      // (geçmişin en eski elemanı, yani bir sonraki yazılacak yuva)
      val noisy = history[historyPos]
      for (i in mixed.indices) mixed[i] = a * noisy[i] + (1 - a) * enhanced[i]
      result = mixed
    }
    framer.synthesize(result, out)
  }

  override fun close() {
    specInTensor.close()
    specOutTensor.close()
    stateTensors.forEach { it.close() }
    session.close()
  }

  companion object {
    private fun directFloats(n: Int): FloatBuffer =
      ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()

    /** Modeli yükler. Tek iş parçacıklı CPU çalıştırıcı: çağıran (ses) iş parçacığında çalışır, boşta dönmez. */
    fun create(model: ByteArray, attenLimDb: Double): DpdfnetEngine {
      val env = OrtEnvironment.getEnvironment()
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(1)
        setInterOpNumThreads(1)
        setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        addConfigEntry("session.intra_op.allow_spinning", "0")
        addConfigEntry("session.inter_op.allow_spinning", "0")
        // GRU durumlarındaki çok küçük (denormal) sayılar işlemciyi yavaşlatmasın
        addConfigEntry("session.set_denormal_as_zero", "1")
      }
      val session = env.createSession(model, options)
      options.close()
      try {
        val meta = session.metadata.customMetadata
        val state = Dpdfnet.initialState(meta)
        val names = Names(
          specIn = pick(session.inputInfo.mapValues { it.value.info }, spectral = true),
          stateIn = pick(session.inputInfo.mapValues { it.value.info }, spectral = false),
          specOut = pick(session.outputInfo.mapValues { it.value.info }, spectral = true),
          stateOut = pick(session.outputInfo.mapValues { it.value.info }, spectral = false),
        )
        return DpdfnetEngine(env, session, state, names).also { it.setAttenLimit(attenLimDb) }
      } catch (t: Throwable) {
        session.close()
        throw t
      }
    }

    /** Spektrum girişi/çıkışı 4 boyutlu ([1,1,481,2]), durum tek boyutlu; bulunamazsa sıraya göre. */
    private fun pick(info: Map<String, Any>, spectral: Boolean): String {
      val names = info.keys.toList()
      require(names.size == 2) { "DPDFNet modelinin beklenmeyen giriş/çıkışları: $names" }
      val byShape = names.firstOrNull { name ->
        val shape = (info[name] as? TensorInfo)?.shape
        shape != null && (shape.size == 4) == spectral
      }
      return byShape ?: if (spectral) names[0] else names[1]
    }
  }
}
