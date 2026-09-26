import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gateWorkletUrl from './gate-worklet.js?url';
import type { MicLevel } from '../../stores/voice';

export interface GateConfig {
  mode: 'vad' | 'ptt' | 'open';
  auto: boolean;
  threshold: number;
  ptt: boolean;
}

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

/**
 * Mikrofon işleme zinciri: [RNNoise] → ses kapısı (VAD / bas-konuş) → LiveKit'e giden track.
 * Kapı kapalıyken sessizlik gönderilir; Opus DTX sayesinde neredeyse hiç bant harcamaz ve
 * diğerleri seni "susturulmuş" görmez (Discord'daki ses aktivitesi/bas-konuş davranışı).
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'diskort-mic';
  processedTrack?: MediaStreamTrack;

  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rnnoise: RnnoiseWorkletNode | null = null;
  private gate: AudioWorkletNode | null = null;
  private building: Promise<void> | null = null;

  constructor(
    private gateConfig: GateConfig,
    private useRnnoise: boolean,
    private readonly onLevel: (level: MicLevel) => void,
  ) {}

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.building = this.build(opts.track);
    await this.building;
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
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
    // RNNoise 48 kHz örnekleme hızı bekler.
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(gateWorkletUrl);

    this.source = ctx.createMediaStreamSource(new MediaStream([track]));
    let node: AudioNode = this.source;

    if (this.useRnnoise) {
      try {
        rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
        const wasmBinary = await rnnoiseBinary;
        await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
        this.rnnoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
        node.connect(this.rnnoise);
        node = this.rnnoise;
      } catch (err) {
        console.warn('RNNoise yüklenemedi, standart gürültü engelleme ile devam ediliyor', err);
        rnnoiseBinary = null;
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

  private async teardown(): Promise<void> {
    await this.building?.catch(() => undefined);
    this.building = null;
    this.gate?.port.close();
    this.gate?.disconnect();
    this.rnnoise?.destroy();
    this.rnnoise?.disconnect();
    this.source?.disconnect();
    this.processedTrack?.stop();
    await this.ctx?.close().catch(() => undefined);
    this.gate = null;
    this.rnnoise = null;
    this.source = null;
    this.ctx = null;
    this.processedTrack = undefined;
  }
}
