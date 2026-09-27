import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import gateWorkletUrl from './gate-worklet.js?url';
import deepFilterWorkletUrl from './deepfilter/deepfilter-worklet.js?url';
import deepFilterWasmUrl from './deepfilter/df.wasm?url';
// Model arşivi .bin uzantılı: .gz uzantısını geliştirme sunucusu 'Content-Encoding: gzip' ile açıp bozuyor.
import deepFilterModelUrl from './deepfilter/DeepFilterNet3_onnx.bin?url';
import dpdfnetWorkletUrl from './dpdfnet/dpdfnet-worklet.js?url';
import dpdfnetModelUrl from './dpdfnet/dpdfnet2_48khz_hr.onnx?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { ALGORITHMIC_DELAY_SAMPLES as DPDFNET_DELAY_SAMPLES } from './dpdfnet/dsp.js';
import type { DpdfnetWorkerInit, DpdfnetWorkerMessage } from './dpdfnet/dpdfnet.worker';
import type { MicLevel } from '../../stores/voice';

export interface GateConfig {
  mode: 'vad' | 'ptt' | 'open';
  auto: boolean;
  threshold: number;
  ptt: boolean;
}

/** Zincirdeki yapay zekâ gürültü engelleyicisi (null: yok, tarayıcınınki veya kapalı) */
export type Denoiser = 'deepfilter' | 'dpdfnet';

const DENOISER_NAMES: Record<Denoiser, string> = {
  deepfilter: 'DeepFilterNet 3',
  dpdfnet: 'DPDFNet-2 48 kHz',
};

/** Son filtre kapalı (konuşmayı daha doğal bırakır). Bastırma sınırı ayarlardan gelir (gürültü engelleme gücü). */
const DF_POST_FILTER_BETA = 0;
/** Model ses iş parçacığında kurulur (~0,2–1 sn); takılırsa standart engellemeye dönülür. */
const DF_READY_TIMEOUT_MS = 10_000;
/**
 * İşlemci yetmiyorsa (ses iş parçacığının yarısından fazlası art arda ~6 sn) standart engellemeye geçilir;
 * aksi halde sesin tamamı cızırdar. Ryzen 5 7500F'te normal yük tek çekirdeğin ~%11–13'ü.
 */
const DF_MAX_LOAD = 0.5;
const DF_MAX_LOAD_REPORTS = 3;

/** DPDFNet Worker'da kurulur (model + ~20 kare ısınma, ~1 sn). */
const DPDFNET_READY_TIMEOUT_MS = 15_000;
/**
 * DPDFNet kendi iş parçacığında çalışır; tek çekirdeğin %60'ını art arda ~6 sn aşarsa (ya da ısınmada kare
 * başına 6 ms'den uzun sürerse) işlemci yetersiz sayılıp DeepFilterNet'e geçilir. Ryzen 5 7500F'te ~%30.
 */
const DPDFNET_MAX_LOAD = 0.6;
const DPDFNET_MAX_WARMUP_FRAME_MS = 6;
const DPDFNET_MAX_LOAD_REPORTS = 3;
/** Art arda 3 raporda (6 sn) boşluk olursa da vazgeçilir (Worker kareleri zamanında döndüremiyor) */
const DPDFNET_MAX_UNDERRUN_REPORTS = 3;

/** DeepFilterNet'in algoritmik gecikmesi: pencere (10 ms) + 2 kare ileri bakış */
const DF_DELAY_SAMPLES = 480 * 3;

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
  /** Model ses iş parçacığında mı çalışıyor (DeepFilterNet) yoksa ayrı Worker'da mı (DPDFNet) */
  thread: 'audio' | 'worker';
  /** Ortalama işlemci yükü (işleme süresi / gerçek süre, tek çekirdek oranı) */
  load: number;
  /** Son aralıktaki (2 sn) kare sayısı ve kare (10 ms) başına işleme süreleri */
  frames: number;
  avgFrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  /** Son aralıkta 2 ms'yi / bir ses bloğunu (2,67 ms) aşan kareler. Ses iş parçacığındaysa cızırtı riski. */
  over2ms: number;
  overQuantum: number;
  /** Başından beri toplam: DeepFilterNet için bu aralıktaki geç blokların etkisi, DPDFNet için boş tampon */
  underruns: number;
  /** Ses yolu gecikmesi: modelin algoritmik gecikmesi + tamponlama (ms) */
  latencyMs: number;
  /** Tüm oturum boyunca en kötü kare (ms) ve 2,67 ms'yi aşan toplam kare */
  worstFrameMs: number;
  totalOverQuantum: number;
}

let deepFilterAssets: Promise<DeepFilterAssets> | null = null;
let deepFilterBroken = false;
let dpdfnetAssets: Promise<DpdfnetAssets> | null = null;
let dpdfnetBroken = false;

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
}

function loadDeepFilterAssets(): Promise<DeepFilterAssets> {
  deepFilterAssets ??= (async () => {
    const [wasm, model] = await Promise.all([fetchBuffer(deepFilterWasmUrl), fetchBuffer(deepFilterModelUrl)]);
    const magic = new Uint8Array(model, 0, 2);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new Error('DeepFilterNet model dosyası bozuk (gzip değil)');
    return { module: await WebAssembly.compile(wasm), model };
  })();
  return deepFilterAssets;
}

function loadDpdfnetAssets(): Promise<DpdfnetAssets> {
  dpdfnetAssets ??= (async () => {
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
  if (which === 'deepfilter') {
    if (!deepFilterBroken) console.warn('DeepFilterNet kullanılamıyor, standart gürültü engellemeye dönülüyor', err);
    deepFilterBroken = true;
    deepFilterAssets = null;
  } else {
    if (!dpdfnetBroken) console.warn('DPDFNet kullanılamıyor, DeepFilterNet’e dönülüyor', err);
    dpdfnetBroken = true;
    dpdfnetAssets = null;
  }
}

/**
 * DeepFilterNet dosyalarını (uygulamayla birlikte gelir, indirme yok) bir kez yükleyip derler.
 * Bu oturumda yüklenemediyse veya çalışırken hata verdiyse false döner.
 */
export async function deepFilterAvailable(): Promise<boolean> {
  if (deepFilterBroken) return false;
  try {
    await loadDeepFilterAssets();
    return true;
  } catch (err) {
    markBroken('deepfilter', err);
    return false;
  }
}

/** DPDFNet dosyalarını (uygulamayla birlikte gelir) bir kez yükler; bu oturumda başarısız olduysa false. */
export async function dpdfnetAvailable(): Promise<boolean> {
  if (dpdfnetBroken) return false;
  try {
    await loadDpdfnetAssets();
    return true;
  } catch (err) {
    markBroken('dpdfnet', err);
    return false;
  }
}

interface FrameStats {
  load: number;
  frames?: number;
  avgFrameMs?: number;
  p99FrameMs?: number;
  maxFrameMs?: number;
  over2ms?: number;
  overQuantum?: number;
}

/**
 * Mikrofon işleme zinciri: [DeepFilterNet 3 | DPDFNet] → ses kapısı (VAD / bas-konuş) → LiveKit'e giden track.
 * Kapı kapalıyken sessizlik gönderilir; Opus DTX sayesinde neredeyse hiç bant harcamaz ve
 * diğerleri seni "susturulmuş" görmez (Discord'daki ses aktivitesi/bas-konuş davranışı).
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'diskort-mic';
  processedTrack?: MediaStreamTrack;
  /** Son ölçülen gürültü engelleyici istatistikleri (geliştirme/tanılama için) */
  stats: MicProcessingStats | null = null;

  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private denoiserNode: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private gate: AudioWorkletNode | null = null;
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
    if (this.denoiser === 'deepfilter' && deepFilterBroken) this.denoiser = null;
    if (this.denoiser === 'dpdfnet' && dpdfnetBroken) this.denoiser = null;
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    await this.teardown();
  }

  updateGate(patch: Partial<GateConfig>): void {
    this.gateConfig = { ...this.gateConfig, ...patch };
    this.gate?.port.postMessage(patch);
  }

  /** Gürültü engelleme gücünü yeniden bağlanmadan değiştirir. */
  setAttenLimit(db: number): void {
    this.attenLimDb = db;
    this.denoiserNode?.port.postMessage({ attenLimDb: db });
    this.worker?.postMessage({ type: 'atten', db });
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
        this.denoiserNode = which === 'deepfilter' ? await this.createDeepFilter(ctx) : await this.createDpdfnet(ctx);
        node.connect(this.denoiserNode);
        node = this.denoiserNode;
      } catch (err) {
        this.denoiserNode?.disconnect();
        this.denoiserNode = null;
        this.worker?.terminate();
        this.worker = null;
        markBroken(which, err);
      }
    }

    this.gate = new AudioWorkletNode(ctx, 'diskort-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.gate.port.postMessage(this.gateConfig);
    this.gate.port.onmessage = (e: MessageEvent<MicLevel>) => this.onLevel(e.data);
    node.connect(this.gate);

    const dest = ctx.createMediaStreamDestination();
    this.gate.connect(dest);
    this.processedTrack = dest.stream.getAudioTracks()[0];
    if (ctx.state === 'suspended') await ctx.resume();
  }

  /** Kurulduktan sonraki hatalar: işlemci sesi geçirir, çağıran bir alt seçenekle yeniden başlatır. */
  private failer(which: Denoiser, node: AudioWorkletNode): (err: unknown) => void {
    let failed = false;
    return (err) => {
      if (failed || this.denoiserNode !== node) return;
      failed = true;
      markBroken(which, err);
      this.onDenoiserFailed?.();
    };
  }

  private updateStats(model: Denoiser, s: FrameStats, extra: { underruns: number; latencyMs: number }): void {
    const prev = this.stats;
    const maxFrameMs = s.maxFrameMs ?? 0;
    this.stats = {
      model: DENOISER_NAMES[model],
      thread: model === 'deepfilter' ? 'audio' : 'worker',
      load: s.load,
      frames: s.frames ?? 0,
      avgFrameMs: s.avgFrameMs ?? 0,
      p99FrameMs: s.p99FrameMs ?? 0,
      maxFrameMs,
      over2ms: s.over2ms ?? 0,
      overQuantum: s.overQuantum ?? 0,
      underruns: extra.underruns,
      latencyMs: extra.latencyMs,
      worstFrameMs: Math.max(prev?.worstFrameMs ?? 0, maxFrameMs),
      totalOverQuantum: (prev?.totalOverQuantum ?? 0) + (s.overQuantum ?? 0),
    };
  }

  private async createDeepFilter(ctx: AudioContext): Promise<AudioWorkletNode> {
    const assets = await loadDeepFilterAssets();
    await ctx.audioWorklet.addModule(deepFilterWorkletUrl);
    const node = new AudioWorkletNode(ctx, 'diskort-deepfilter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
      processorOptions: {
        wasmModule: assets.module,
        modelBytes: assets.model,
        attenLimDb: this.attenLimDb,
        postFilterBeta: DF_POST_FILTER_BETA,
      },
    });
    this.denoiserNode = node;
    let bufferSamples = 448;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('DeepFilterNet zaman aşımı')), DF_READY_TIMEOUT_MS);
      node.onprocessorerror = () => {
        window.clearTimeout(timer);
        reject(new Error('DeepFilterNet işlemcisi çöktü'));
      };
      node.port.onmessage = (e: MessageEvent<{ type: string; message?: string; bufferSamples?: number }>) => {
        if (e.data.type === 'ready') {
          window.clearTimeout(timer);
          bufferSamples = e.data.bufferSamples ?? bufferSamples;
          resolve();
        } else if (e.data.type === 'error') {
          window.clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
    });
    const fail = this.failer('deepfilter', node);
    node.onprocessorerror = () => fail(new Error('DeepFilterNet işlemcisi çöktü'));
    let overloaded = 0;
    const latencyMs = ((DF_DELAY_SAMPLES + bufferSamples) / 48000) * 1000;
    node.port.onmessage = (e: MessageEvent<{ type: string; message?: string; underruns: number } & FrameStats>) => {
      if (e.data.type === 'stats') {
        this.updateStats('deepfilter', e.data, { underruns: e.data.underruns, latencyMs });
        overloaded = e.data.load > DF_MAX_LOAD ? overloaded + 1 : 0;
        if (overloaded >= DF_MAX_LOAD_REPORTS) fail(new Error(`işlemci yetersiz (yük ${Math.round(e.data.load * 100)}%)`));
      } else if (e.data.type === 'error') {
        fail(new Error(e.data.message));
      }
    };
    return node;
  }

  private async createDpdfnet(ctx: AudioContext): Promise<AudioWorkletNode> {
    const assets = await loadDpdfnetAssets();
    await ctx.audioWorklet.addModule(dpdfnetWorkletUrl);
    const worker = new Worker(new URL('./dpdfnet/dpdfnet.worker.ts', import.meta.url), {
      type: 'module',
      name: 'diskort-dpdfnet',
    });
    this.worker = worker;
    const node = new AudioWorkletNode(ctx, 'diskort-dpdfnet', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
    });
    this.denoiserNode = node;

    // Worklet ile Worker doğrudan konuşur (ana iş parçacığı ses yolunda değil)
    const channel = new MessageChannel();
    const init: DpdfnetWorkerInit = {
      type: 'init',
      // Önbellekteki kopyalar korunur (Worker'a kopyalanır); yeniden kurulumda tekrar indirme olmaz
      wasm: assets.wasm.slice(0),
      model: assets.model.slice(0),
      attenLimDb: this.attenLimDb,
      port: channel.port1,
    };
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('DPDFNet zaman aşımı')), DPDFNET_READY_TIMEOUT_MS);
      const done = (err?: Error): void => {
        window.clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      worker.onerror = (e) => done(new Error(`DPDFNet işçisi başlatılamadı: ${e.message}`));
      node.onprocessorerror = () => done(new Error('DPDFNet worklet çöktü'));
      worker.onmessage = (e: MessageEvent<DpdfnetWorkerMessage>) => {
        const m = e.data;
        if (m.type === 'ready') {
          if (m.warmupFrameMs > DPDFNET_MAX_WARMUP_FRAME_MS) {
            done(new Error(`işlemci yetersiz (kare başına ${m.warmupFrameMs.toFixed(1)} ms)`));
          } else done();
        } else if (m.type === 'error') done(new Error(m.message));
      };
      worker.postMessage(init, [init.wasm, init.model, channel.port1]);
    });
    node.port.postMessage({ type: 'connect', port: channel.port2 }, [channel.port2]);

    const fail = this.failer('dpdfnet', node);
    node.onprocessorerror = () => fail(new Error('DPDFNet worklet çöktü'));
    worker.onerror = (e) => fail(new Error(`DPDFNet işçisi çöktü: ${e.message}`));
    let overloaded = 0;
    let starved = 0;
    let underruns = 0;
    let lastUnderruns = 0;
    let latencyMs = ((DPDFNET_DELAY_SAMPLES + 448 + 480) / 48000) * 1000;
    worker.onmessage = (e: MessageEvent<DpdfnetWorkerMessage>) => {
      const m = e.data;
      if (m.type === 'stats') {
        this.updateStats('dpdfnet', m, { underruns, latencyMs });
        overloaded = m.load > DPDFNET_MAX_LOAD ? overloaded + 1 : 0;
        if (overloaded >= DPDFNET_MAX_LOAD_REPORTS) fail(new Error(`işlemci yetersiz (yük ${Math.round(m.load * 100)}%)`));
      } else if (m.type === 'error') {
        fail(new Error(m.message));
      }
    };
    node.port.onmessage = (e: MessageEvent<{ type: string; underruns: number; bufferMs: number }>) => {
      if (e.data.type !== 'stats') return;
      underruns = e.data.underruns;
      latencyMs = (DPDFNET_DELAY_SAMPLES / 48000) * 1000 + e.data.bufferMs;
      if (this.stats) this.stats = { ...this.stats, underruns, latencyMs };
      starved = underruns > lastUnderruns ? starved + 1 : 0;
      lastUnderruns = underruns;
      if (starved >= DPDFNET_MAX_UNDERRUN_REPORTS) fail(new Error('DPDFNet kareleri zamanında işlenemiyor'));
    };
    return node;
  }

  private async teardown(): Promise<void> {
    await this.building?.catch(() => undefined);
    this.building = null;
    this.gate?.port.close();
    this.gate?.disconnect();
    this.denoiserNode?.port.close();
    this.denoiserNode?.disconnect();
    this.worker?.terminate();
    this.source?.disconnect();
    this.processedTrack?.stop();
    await this.ctx?.close().catch(() => undefined);
    this.gate = null;
    this.denoiserNode = null;
    this.worker = null;
    this.source = null;
    this.ctx = null;
    this.processedTrack = undefined;
    this.stats = null;
  }
}
