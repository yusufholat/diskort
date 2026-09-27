import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import gateWorkletUrl from './gate-worklet.js?url';
import bridgeWorkletUrl from './denoise/bridge-worklet.js?url';
// Hesap worklet'i onnxruntime-web ile birlikte tek ES modülü olarak paketlenir (worklet'ler içe aktarma çözemez)
import computeWorkletUrl from './denoise/compute.worklet.ts?worker&url';
import deepFilterWasmUrl from './deepfilter/df.wasm?url';
// Model arşivi .bin uzantılı: .gz uzantısını geliştirme sunucusu 'Content-Encoding: gzip' ile açıp bozuyor.
import deepFilterModelUrl from './deepfilter/DeepFilterNet3_onnx.bin?url';
import dpdfnetModelUrl from './dpdfnet/dpdfnet2_48khz_hr.onnx?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { ALGORITHMIC_DELAY_SAMPLES as DPDFNET_DELAY_SAMPLES } from './dpdfnet/dsp.js';
import { createRing, HOP } from './denoise/ring';
import type { EngineInit, HostMessage, HostStats } from './denoise/engine';
import type { WorkerInit } from './denoise/denoise.worker';
import type { MicLevel } from '../../stores/voice';

export interface GateConfig {
  mode: 'vad' | 'ptt' | 'open';
  auto: boolean;
  threshold: number;
  ptt: boolean;
}

/** Zincirdeki yapay zekâ gürültü engelleyicisi */
export type Denoiser = 'deepfilter' | 'dpdfnet';

interface DenoiserSpec {
  name: string;
  /** Modelin algoritmik gecikmesi (örnek) */
  delaySamples: number;
  /** Tek çekirdeğin bu oranını art arda DENOISER_MAX_LOAD_REPORTS rapor aşarsa işlemci yetersiz sayılır */
  maxLoad: number;
  /** Isınmada kare başına bundan uzun sürerse hiç başlatılmaz (işlemci yetersiz) */
  maxWarmupFrameMs: number;
}

const DENOISERS: Record<Denoiser, DenoiserSpec> = {
  // Ryzen 5 7500F'te kare başına ~1,2 ms (tek çekirdeğin ~%12'si). Gecikme: pencere + 2 kare ileri bakış.
  deepfilter: { name: 'DeepFilterNet 3', delaySamples: 3 * HOP, maxLoad: 0.5, maxWarmupFrameMs: 8 },
  // ~3 kat ağır: kare başına ~3 ms (~%30). Gecikme: pencere + 4 kare model gecikmesi.
  dpdfnet: { name: 'DPDFNet-2 48 kHz', delaySamples: DPDFNET_DELAY_SAMPLES, maxLoad: 0.6, maxWarmupFrameMs: 6 },
};

/** Son filtre kapalı (konuşmayı daha doğal bırakır). Bastırma sınırı ayarlardan gelir (gürültü engelleme gücü). */
const DF_POST_FILTER_BETA = 0;
/** Model kurulumu + ısınma (~0,3–1 sn); takılırsa bir alt seçeneğe dönülür. */
const DENOISER_READY_TIMEOUT_MS = 15_000;
const DENOISER_MAX_LOAD_REPORTS = 3;
/** Art arda 3 raporda (~6 sn) ses boşluğu olursa da vazgeçilir (kareler zamanında bitirilemiyor). */
const DENOISER_MAX_UNDERRUN_REPORTS = 3;
/**
 * Köprüdeki ek pay (2 kare = 20 ms): hesap bağlamının kendi ses bloğu takvimi (10 ms'lik çağrılar) ve kare
 * süresi bu payın içinde kalır. Boşluk olursa köprü payı bir blok artırır (en fazla 4 kare).
 */
const BRIDGE_EXTRA_SAMPLES = 2 * HOP;
const BRIDGE_MAX_EXTRA_SAMPLES = 4 * HOP;

export type DenoiseHostKind = 'realtime' | 'worker';

/** Modeli barındıran iş parçacığıyla (hesap worklet'i ya da işçi) ortak arayüz */
interface DenoiseHost {
  kind: DenoiseHostKind;
  send(msg: { type: 'atten'; db: number }): void;
  listen(onMessage: (m: HostMessage) => void, onCrash: (err: Error) => void): void;
  close(): void;
}

interface DeepFilterAssets {
  module: WebAssembly.Module;
  model: ArrayBuffer;
}

interface DpdfnetAssets {
  wasm: ArrayBuffer;
  model: ArrayBuffer;
}

/** Mikrofon işleme ölçümleri (bağlantı panelindeki "Hata ayıklama" ve tanılama bilgisi için) */
export interface MicProcessingStats {
  model: string;
  /**
   * Modelin çalıştığı yer: ayrı, sessiz bir AudioContext'in gerçek zamanlı ses iş parçacığı (birincil) ya da
   * Web Worker (yedek). Mikrofonun ses iş parçacığı her iki durumda da yalnızca örnek kopyalar.
   */
  host: DenoiseHostKind;
  /** Ortalama işlemci yükü (işleme süresi / gerçek süre, tek çekirdek oranı) */
  load: number;
  /** Son aralıktaki (2 sn) kare sayısı ve kare (10 ms) başına işleme süreleri */
  frames: number;
  avgFrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  /** Son aralıkta 2 ms'yi / bir ses bloğunu (2,67 ms) / bir kareyi (10 ms) aşan kareler */
  over2ms: number;
  overQuantum: number;
  overHop: number;
  /** Başından beri: köprünün çıkış tamponu boşaldı (duyulabilir kısa boşluk) */
  underruns: number;
  /** Başından beri model takıldığı için atılan örnekler */
  droppedSamples: number;
  /** Ses yolu gecikmesi: modelin algoritmik gecikmesi + köprü tamponu (ms) */
  latencyMs: number;
  /** Tüm oturum boyunca en kötü kare (ms) ve 2,67 ms'yi aşan toplam kare */
  worstFrameMs: number;
  totalOverQuantum: number;
}

let deepFilterAssets: Promise<DeepFilterAssets> | null = null;
let dpdfnetAssets: Promise<DpdfnetAssets> | null = null;
const broken = new Set<Denoiser>();

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
}

/** Model işçide, ses iş parçacığıyla paylaşımlı bellek üzerinden konuşur (bkz. ana süreçteki anahtar). */
function assertSharedMemory(): void {
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('SharedArrayBuffer kullanılamıyor');
}

function loadDeepFilterAssets(): Promise<DeepFilterAssets> {
  deepFilterAssets ??= (async () => {
    assertSharedMemory();
    const [wasm, model] = await Promise.all([fetchBuffer(deepFilterWasmUrl), fetchBuffer(deepFilterModelUrl)]);
    const magic = new Uint8Array(model, 0, 2);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new Error('DeepFilterNet model dosyası bozuk (gzip değil)');
    return { module: await WebAssembly.compile(wasm), model };
  })();
  return deepFilterAssets;
}

function loadDpdfnetAssets(): Promise<DpdfnetAssets> {
  dpdfnetAssets ??= (async () => {
    assertSharedMemory();
    const [wasm, model] = await Promise.all([fetchBuffer(ortWasmUrl), fetchBuffer(dpdfnetModelUrl)]);
    const magic = new Uint8Array(wasm, 0, Math.min(4, wasm.byteLength));
    if (magic[0] !== 0 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
      throw new Error('onnxruntime wasm dosyası bozuk');
    }
    return { wasm, model };
  })();
  return dpdfnetAssets;
}

function markBroken(which: Denoiser, err: unknown): void {
  if (!broken.has(which)) console.warn(`${DENOISERS[which].name} kullanılamıyor, bir alt seçeneğe dönülüyor`, err);
  broken.add(which);
  if (which === 'deepfilter') deepFilterAssets = null;
  else dpdfnetAssets = null;
}

async function available(which: Denoiser, load: () => Promise<unknown>): Promise<boolean> {
  if (broken.has(which)) return false;
  try {
    await load();
    return true;
  } catch (err) {
    markBroken(which, err);
    return false;
  }
}

/**
 * DeepFilterNet dosyalarını (uygulamayla birlikte gelir, indirme yok) bir kez yükleyip derler.
 * Bu oturumda yüklenemediyse veya çalışırken hata verdiyse false döner.
 */
export function deepFilterAvailable(): Promise<boolean> {
  return available('deepfilter', loadDeepFilterAssets);
}

/** DPDFNet dosyalarını (uygulamayla birlikte gelir) bir kez yükler; bu oturumda başarısız olduysa false. */
export function dpdfnetAvailable(): Promise<boolean> {
  return available('dpdfnet', loadDpdfnetAssets);
}

/**
 * Mikrofon işleme zinciri: [köprü ⇄ model: DeepFilterNet 3 | DPDFNet] → ses kapısı (VAD / bas-konuş) → LiveKit.
 * Gürültü engelleyici mikrofonun ses iş parçacığında çalışmaz: oradaki köprü (bridge-worklet.js) yalnızca
 * paylaşımlı halka tamponlara örnek kopyalar. Model, ayrı ve sessiz ikinci bir AudioContext'in gerçek zamanlı
 * ses iş parçacığında (compute.worklet.ts) çalışır; o kurulamazsa bir Web Worker'da (denoise.worker.ts).
 * Böylece yavaş bir kare çıkan sesi cızırdatmaz, işlemci yoğunken de model bekletilmez.
 * Kapı kapalıyken sessizlik gönderilir; Opus DTX sayesinde neredeyse hiç bant harcamaz ve
 * diğerleri seni "susturulmuş" görmez (Discord'daki ses aktivitesi/bas-konuş davranışı).
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'diskort-mic';
  processedTrack?: MediaStreamTrack;
  /**
   * Aynı işlenmiş ses (kapı dahil) ama odaya gitmeyen dinleme kolu: görüşmedeyken mikrofon testi bunu çalar
   * ya da kaydeder. Odaya gönderim (processedTrack) susturulsa da akmaya devam eder.
   */
  monitorTrack?: MediaStreamTrack;
  /** Zincir (yeniden) kurulunca çağrılır; dinleme kolu yeni bir iz olur (ör. LiveKit mikrofonu yeniden açtı). */
  onRebuilt: (() => void) | null = null;
  /** Son ölçülen gürültü engelleyici istatistikleri (tanılama için) */
  stats: MicProcessingStats | null = null;

  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private denoiserNode: AudioWorkletNode | null = null;
  private host: DenoiseHost | null = null;
  private gate: AudioWorkletNode | null = null;
  private sendGain: GainNode | null = null;
  /** Odaya gönderim susturuldu mu (mikrofon testi sürerken); zincir yeniden kurulsa da korunur */
  private sendMuted = false;
  /** Giriş ses seviyesi (Ayarlar > Ses / mikrofon menüsü); gürültü engelleyiciden sonra, eşikten önce */
  private gain: GainNode | null = null;
  private inputGain = 1;
  private building: Promise<void> | null = null;

  constructor(
    private gateConfig: GateConfig,
    private denoiser: Denoiser | null,
    /** Bastırma sınırı (dB); 100 = sınırsız. Sınır, özgün sesin bir kısmını koruyarak doğal bırakır. */
    private attenLimDb: number,
    private readonly onLevel: (level: MicLevel) => void,
    /** Gürültü engelleyici çalışırken hata verirse çağrılır (bir alt seçenekle yeniden başlatmak için) */
    private readonly onDenoiserFailed?: () => void,
  ) {}

  /** Gürültü engelleyici istenip de kurulamadıysa true (çağıran tarafça bir alt seçeneğe geçilir). */
  get denoiserFailed(): boolean {
    return this.denoiser !== null && !this.denoiserNode;
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.building = this.build(opts.track);
    await this.building;
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    // Bir kez başarısız olduysa yeniden denenmez; track bir alt seçenekle yeniden açılmıştır.
    if (this.denoiser && broken.has(this.denoiser)) this.denoiser = null;
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    await this.teardown();
  }

  updateGate(patch: Partial<GateConfig>): void {
    this.gateConfig = { ...this.gateConfig, ...patch };
    this.gate?.port.postMessage(patch);
  }

  /**
   * Odaya gidene sessizlik verir (dinleme kolu etkilenmez). LiveKit'in susturması mikrofonun kendisini kapattığı
   * için testte kullanılamaz; bu kazanç yalnızca gönderilen kolu keser. Susturma anında, açma yumuşak uygulanır.
   */
  setSendMuted(muted: boolean): void {
    this.sendMuted = muted;
    const gain = this.sendGain;
    if (!gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    if (muted) gain.gain.setValueAtTime(0, now);
    else gain.gain.setTargetAtTime(1, now, 0.01);
  }

  /** Giriş ses seviyesini (0–2) yeniden bağlanmadan değiştirir; zincir kurulmadan önce de çağrılabilir. */
  setInputGain(value: number): void {
    this.inputGain = value;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  /** Gürültü engelleme gücünü yeniden bağlanmadan değiştirir. */
  setAttenLimit(db: number): void {
    this.attenLimDb = db;
    this.host?.send({ type: 'atten', db });
  }

  private async build(track: MediaStreamTrack): Promise<void> {
    // DeepFilterNet ve DPDFNet 48 kHz örnekleme hızı bekler.
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    await ctx.audioWorklet.addModule(gateWorkletUrl);

    this.source = ctx.createMediaStreamSource(new MediaStream([track]));
    let node: AudioNode = this.source;

    const which = this.denoiser;
    if (which) {
      try {
        this.denoiserNode = await this.createDenoiser(ctx, which);
        node.connect(this.denoiserNode);
        node = this.denoiserNode;
      } catch (err) {
        this.denoiserNode?.disconnect();
        this.denoiserNode = null;
        this.host?.close();
        this.host = null;
        markBroken(which, err);
      }
    }

    this.gain = ctx.createGain();
    this.gain.gain.value = this.inputGain;
    node.connect(this.gain);
    node = this.gain;

    this.gate = new AudioWorkletNode(ctx, 'diskort-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.gate.port.postMessage(this.gateConfig);
    this.gate.port.onmessage = (e: MessageEvent<MicLevel>) => this.onLevel(e.data);
    node.connect(this.gate);

    const dest = ctx.createMediaStreamDestination();
    this.sendGain = ctx.createGain();
    this.sendGain.gain.value = this.sendMuted ? 0 : 1;
    this.gate.connect(this.sendGain).connect(dest);
    this.processedTrack = dest.stream.getAudioTracks()[0];
    const monitor = ctx.createMediaStreamDestination();
    this.gate.connect(monitor);
    this.monitorTrack = monitor.stream.getAudioTracks()[0];
    if (ctx.state === 'suspended') await ctx.resume();
    this.onRebuilt?.();
  }

  /** Model dosyaları (önbellekteki kopyalar korunur; yeniden kurulumda tekrar indirme olmaz) */
  private async engineInit(which: Denoiser): Promise<EngineInit> {
    if (which === 'deepfilter') {
      const a = await loadDeepFilterAssets();
      return {
        kind: 'deepfilter',
        attenLimDb: this.attenLimDb,
        wasmModule: a.module,
        model: a.model.slice(0),
        postFilterBeta: DF_POST_FILTER_BETA,
      };
    }
    const a = await loadDpdfnetAssets();
    return { kind: 'dpdfnet', attenLimDb: this.attenLimDb, ortWasm: a.wasm.slice(0), model: a.model.slice(0) };
  }

  /**
   * Birincil barındırıcı: ayrı, sessiz bir AudioContext'in AudioWorklet'i. Chromium her bağlama kendi gerçek
   * zamanlı öncelikli ses iş parçacığını verir; bu bağlamın çıkışı sessizdir, geç kalması duyulmaz.
   */
  private async startRealtimeHost(sab: SharedArrayBuffer, init: EngineInit): Promise<DenoiseHost> {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    try {
      await ctx.audioWorklet.addModule(computeWorkletUrl);
      const node = new AudioWorkletNode(ctx, 'diskort-denoise-compute', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { sab, ...init },
      });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      await ctx.resume();
      return {
        kind: 'realtime',
        send: (msg) => node.port.postMessage(msg),
        listen: (onMessage, onCrash) => {
          node.port.onmessage = (e: MessageEvent<HostMessage>) => onMessage(e.data);
          node.onprocessorerror = () => onCrash(new Error('hesap worklet’i çöktü'));
        },
        close: () => {
          node.port.onmessage = null;
          node.disconnect();
          void ctx.close().catch(() => undefined);
        },
      };
    } catch (err) {
      void ctx.close().catch(() => undefined);
      throw err;
    }
  }

  /** Yedek barındırıcı: Web Worker (normal öncelikli; işlemci çok yoğunken bekletilebilir). */
  private startWorkerHost(sab: SharedArrayBuffer, init: EngineInit): DenoiseHost {
    const worker = new Worker(new URL('./denoise/denoise.worker.ts', import.meta.url), {
      type: 'module',
      name: 'diskort-denoise',
    });
    const msg: WorkerInit = { type: 'init', sab, ...init };
    worker.postMessage(msg, [init.model, ...(init.kind === 'dpdfnet' ? [init.ortWasm] : [])]);
    return {
      kind: 'worker',
      send: (m) => worker.postMessage(m),
      listen: (onMessage, onCrash) => {
        worker.onmessage = (e: MessageEvent<HostMessage>) => onMessage(e.data);
        worker.onerror = (e) => onCrash(new Error(`işçi çöktü: ${e.message}`));
      },
      close: () => worker.terminate(),
    };
  }

  /** Barındırıcı modeli kurup ısıtana kadar bekler; işlemci yetmiyorsa reddeder. */
  private waitReady(host: DenoiseHost, spec: DenoiserSpec): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${spec.name} zaman aşımı`)), DENOISER_READY_TIMEOUT_MS);
      const done = (err?: Error): void => {
        window.clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      host.listen(
        (m) => {
          if (m.type === 'ready') {
            if (m.warmupFrameMs > spec.maxWarmupFrameMs) {
              done(new Error(`işlemci yetersiz (kare başına ${m.warmupFrameMs.toFixed(1)} ms)`));
            } else done();
          } else if (m.type === 'error') done(new Error(m.message));
        },
        (err) => done(err),
      );
    });
  }

  private async createDenoiser(ctx: AudioContext, which: Denoiser): Promise<AudioWorkletNode> {
    const spec = DENOISERS[which];
    assertSharedMemory();
    await ctx.audioWorklet.addModule(bridgeWorkletUrl);

    let sab = createRing();
    let host: DenoiseHost;
    try {
      host = await this.startRealtimeHost(sab, await this.engineInit(which));
      this.host = host;
      await this.waitReady(host, spec);
    } catch (err) {
      // İşlemci yetmiyorsa işçide de yetmez; başka bir hata (ör. worklet kurulamadı) ise işçi denenir.
      if (err instanceof Error && err.message.startsWith('işlemci yetersiz')) throw err;
      console.warn(`${spec.name}: gerçek zamanlı hesap bağlamı kurulamadı, işçiye geçiliyor`, err);
      this.host?.close();
      sab = createRing();
      host = this.startWorkerHost(sab, await this.engineInit(which));
      this.host = host;
      await this.waitReady(host, spec);
    }

    const node = new AudioWorkletNode(ctx, 'diskort-denoise-bridge', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
      processorOptions: { sab, extraSamples: BRIDGE_EXTRA_SAMPLES, maxExtraSamples: BRIDGE_MAX_EXTRA_SAMPLES },
    });
    this.denoiserNode = node;

    // Kurulduktan sonraki hatalar: çağıran bir alt seçenekle (DPDFNet → DeepFilterNet → standart) yeniden başlatır.
    let failed = false;
    const fail = (err: unknown): void => {
      if (failed || this.denoiserNode !== node) return;
      failed = true;
      markBroken(which, err);
      this.onDenoiserFailed?.();
    };
    node.onprocessorerror = () => fail(new Error(`${spec.name} köprüsü çöktü`));
    let overloaded = 0;
    let starved = 0;
    let lastUnderruns = 0;
    const hostKind = host.kind;
    host.listen(
      (m) => {
        if (m.type === 'stats') {
          this.updateStats(spec, hostKind, m);
          overloaded = m.load > spec.maxLoad ? overloaded + 1 : 0;
          starved = m.underruns > lastUnderruns ? starved + 1 : 0;
          lastUnderruns = m.underruns;
          if (overloaded >= DENOISER_MAX_LOAD_REPORTS) fail(new Error(`işlemci yetersiz (yük ${Math.round(m.load * 100)}%)`));
          else if (starved >= DENOISER_MAX_UNDERRUN_REPORTS) fail(new Error('kareler zamanında işlenemiyor'));
        } else if (m.type === 'error') {
          fail(new Error(m.message));
        }
      },
      (err) => fail(err),
    );
    return node;
  }

  private updateStats(spec: DenoiserSpec, host: DenoiseHostKind, s: HostStats): void {
    const prev = this.stats;
    this.stats = {
      model: spec.name,
      host,
      load: s.load,
      frames: s.frames,
      avgFrameMs: s.avgFrameMs,
      p99FrameMs: s.p99FrameMs,
      maxFrameMs: s.maxFrameMs,
      over2ms: s.over2ms,
      overQuantum: s.overQuantum,
      overHop: s.overHop,
      underruns: s.underruns,
      droppedSamples: s.droppedSamples,
      latencyMs: (spec.delaySamples / 48000) * 1000 + s.bufferMs,
      worstFrameMs: Math.max(prev?.worstFrameMs ?? 0, s.maxFrameMs),
      totalOverQuantum: (prev?.totalOverQuantum ?? 0) + s.overQuantum,
    };
  }

  private async teardown(): Promise<void> {
    await this.building?.catch(() => undefined);
    this.building = null;
    this.gate?.port.close();
    this.gate?.disconnect();
    this.sendGain?.disconnect();
    this.denoiserNode?.disconnect();
    this.gain?.disconnect();
    this.host?.close();
    this.source?.disconnect();
    this.processedTrack?.stop();
    this.monitorTrack?.stop();
    await this.ctx?.close().catch(() => undefined);
    this.gate = null;
    this.sendGain = null;
    this.denoiserNode = null;
    this.gain = null;
    this.host = null;
    this.source = null;
    this.ctx = null;
    this.processedTrack = undefined;
    this.monitorTrack = undefined;
    this.stats = null;
  }
}
