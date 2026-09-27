import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import gateWorkletUrl from './gate-worklet.js?url';
import deepFilterWorkletUrl from './deepfilter/deepfilter-worklet.js?url';
import deepFilterWasmUrl from './deepfilter/df.wasm?url';
// Model arşivi .bin uzantılı: .gz uzantısını geliştirme sunucusu 'Content-Encoding: gzip' ile açıp bozuyor.
import deepFilterModelUrl from './deepfilter/DeepFilterNet3_onnx.bin?url';
import type { MicLevel } from '../../stores/voice';

export interface GateConfig {
  mode: 'vad' | 'ptt' | 'open';
  auto: boolean;
  threshold: number;
  ptt: boolean;
}

/** DeepFilterNet ayarları: 100 dB = bastırma sınırı yok, son filtre kapalı (konuşmayı daha doğal bırakır). */
const DF_ATTEN_LIM_DB = 100;
const DF_POST_FILTER_BETA = 0;
/** Model ses iş parçacığında kurulur (~0,2–1 sn); takılırsa standart engellemeye dönülür. */
const DF_READY_TIMEOUT_MS = 10_000;
/**
 * İşlemci yetmiyorsa (ses iş parçacığının yarısından fazlası art arda ~6 sn) standart engellemeye geçilir;
 * aksi halde sesin tamamı cızırdar. Ryzen 5 7500F'te normal yük tek çekirdeğin ~%11–13'ü.
 */
const DF_MAX_LOAD = 0.5;
const DF_MAX_LOAD_REPORTS = 3;

interface DeepFilterAssets {
  module: WebAssembly.Module;
  model: ArrayBuffer;
}

export interface DeepFilterStats {
  /** İşlemci yükü (işleme süresi / gerçek süre, tek çekirdek oranı) */
  load: number;
  underruns: number;
}

let deepFilterAssets: Promise<DeepFilterAssets> | null = null;
let deepFilterBroken = false;

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

function markDeepFilterBroken(err: unknown): void {
  if (!deepFilterBroken) console.warn('DeepFilterNet kullanılamıyor, standart gürültü engellemeye dönülüyor', err);
  deepFilterBroken = true;
  deepFilterAssets = null;
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
    markDeepFilterBroken(err);
    return false;
  }
}

/**
 * Mikrofon işleme zinciri: [DeepFilterNet 3] → ses kapısı (VAD / bas-konuş) → LiveKit'e giden track.
 * Kapı kapalıyken sessizlik gönderilir; Opus DTX sayesinde neredeyse hiç bant harcamaz ve
 * diğerleri seni "susturulmuş" görmez (Discord'daki ses aktivitesi/bas-konuş davranışı).
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'diskort-mic';
  processedTrack?: MediaStreamTrack;
  /** Son ölçülen DeepFilterNet yükü (geliştirme/tanılama için) */
  deepFilterStats: DeepFilterStats | null = null;

  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private deepFilter: AudioWorkletNode | null = null;
  private gate: AudioWorkletNode | null = null;
  private building: Promise<void> | null = null;

  constructor(
    private gateConfig: GateConfig,
    private useDeepFilter: boolean,
    private readonly onLevel: (level: MicLevel) => void,
    /** DeepFilterNet çalışırken hata verirse çağrılır (standart engellemeyle yeniden başlatmak için) */
    private readonly onDenoiserFailed?: () => void,
  ) {}

  /** DeepFilterNet istenip de kurulamadıysa true (çağıran tarafça standart engellemeye geçilir). */
  get denoiserFailed(): boolean {
    return this.useDeepFilter && !this.deepFilter;
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.building = this.build(opts.track);
    await this.building;
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    // Bir kez başarısız olduysa yeniden denenmez; track standart engellemeyle yeniden açılmıştır.
    if (deepFilterBroken) this.useDeepFilter = false;
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    await this.teardown();
  }

  updateGate(patch: Partial<GateConfig>): void {
    this.gateConfig = { ...this.gateConfig, ...patch };
    this.gate?.port.postMessage(patch);
  }

  private async build(track: MediaStreamTrack): Promise<void> {
    // DeepFilterNet 48 kHz örnekleme hızı bekler.
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    await ctx.audioWorklet.addModule(gateWorkletUrl);

    this.source = ctx.createMediaStreamSource(new MediaStream([track]));
    let node: AudioNode = this.source;

    if (this.useDeepFilter) {
      try {
        this.deepFilter = await this.createDeepFilter(ctx);
        node.connect(this.deepFilter);
        node = this.deepFilter;
      } catch (err) {
        this.deepFilter?.disconnect();
        this.deepFilter = null;
        markDeepFilterBroken(err);
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
        attenLimDb: DF_ATTEN_LIM_DB,
        postFilterBeta: DF_POST_FILTER_BETA,
      },
    });
    this.deepFilter = node;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('DeepFilterNet zaman aşımı')), DF_READY_TIMEOUT_MS);
      node.onprocessorerror = () => {
        window.clearTimeout(timer);
        reject(new Error('DeepFilterNet işlemcisi çöktü'));
      };
      node.port.onmessage = (e: MessageEvent<{ type: string; message?: string }>) => {
        if (e.data.type === 'ready') {
          window.clearTimeout(timer);
          resolve();
        } else if (e.data.type === 'error') {
          window.clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
    });
    // Kurulduktan sonraki hatalar: işlemci sesi olduğu gibi geçirir, çağıran standart engellemeye geçer.
    let failed = false;
    const fail = (err: unknown): void => {
      if (failed || this.deepFilter !== node) return;
      failed = true;
      markDeepFilterBroken(err);
      this.onDenoiserFailed?.();
    };
    node.onprocessorerror = () => fail(new Error('DeepFilterNet işlemcisi çöktü'));
    let overloaded = 0;
    node.port.onmessage = (e: MessageEvent<{ type: string; message?: string } & DeepFilterStats>) => {
      if (e.data.type === 'stats') {
        this.deepFilterStats = { load: e.data.load, underruns: e.data.underruns };
        overloaded = e.data.load > DF_MAX_LOAD ? overloaded + 1 : 0;
        if (overloaded >= DF_MAX_LOAD_REPORTS) fail(new Error(`işlemci yetersiz (yük ${Math.round(e.data.load * 100)}%)`));
      } else if (e.data.type === 'error') {
        fail(new Error(e.data.message));
      }
    };
    return node;
  }

  private async teardown(): Promise<void> {
    await this.building?.catch(() => undefined);
    this.building = null;
    this.gate?.port.close();
    this.gate?.disconnect();
    this.deepFilter?.port.close();
    this.deepFilter?.disconnect();
    this.source?.disconnect();
    this.processedTrack?.stop();
    await this.ctx?.close().catch(() => undefined);
    this.gate = null;
    this.deepFilter = null;
    this.source = null;
    this.ctx = null;
    this.processedTrack = undefined;
    this.deepFilterStats = null;
  }
}
