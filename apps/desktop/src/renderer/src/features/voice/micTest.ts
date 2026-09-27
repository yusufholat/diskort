import { Track, type AudioCaptureOptions } from 'livekit-client';
import { sharedAudioContext } from '../../lib/sfx';
import { getSettings, useSettings, type Settings } from '../../stores/settings';
import { setVoice, useVoice } from '../../stores/voice';
import { MicProcessor, type Denoiser, type GateConfig } from './micProcessor';

/** Gerçek görüşmedeki mikrofon zincirini kuran yardımcılar (voiceClient'tan) */
export interface MicTestDeps {
  wantedDenoiser(): Promise<Denoiser | null>;
  captureOptions(denoiser: Denoiser | null): AudioCaptureOptions;
  gateConfig(): GateConfig;
}

export type MicTestPhase = 'recording' | 'playing' | null;

/** "Kaydet ve dinle" kaydının süresi */
export const MIC_TEST_RECORD_MS = 5000;

type Sinkable = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

function setSink(el: HTMLAudioElement, deviceId: string): Promise<void> {
  return (
    (el as Sinkable).setSinkId?.(deviceId === 'default' ? '' : deviceId).catch(() => undefined) ?? Promise.resolve()
  );
}

/** Yeniden kurulum gerektiren ayarlar (görüşmede mikrofonu yeniden yayınlatanlarla aynı) */
function needsRebuild(n: Settings, p: Settings): boolean {
  return (
    n.inputDeviceId !== p.inputDeviceId ||
    n.noise !== p.noise ||
    n.echoCancellation !== p.echoCancellation ||
    n.autoGainControl !== p.autoGainControl
  );
}

/**
 * Ayarlar ekranındaki mikrofon testi: görüşmedekiyle aynı işlem zinciri (seçili giriş aygıtı, yankı engelleme,
 * otomatik kazanç, gürültü engelleme + gücü, ses kapısı). Seviye göstergesini besler; istenirse işlenmiş sesi
 * seçili çıkış aygıtından geri çalar ya da 5 sn kaydedip dinletir. Ayar değişiklikleri test sürerken uygulanır.
 * Ses kanalına girilince kendini kapatır (mikrofon görüşmeye geçer).
 */
export class MicTest {
  private track: MediaStreamTrack | null = null;
  private processor: MicProcessor | null = null;
  /** İşlem zincirinin kurulum/yeniden kurulum sırası (yarışları önler) */
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private loopback = false;
  private phase: MicTestPhase = null;
  private readonly loopEl: HTMLAudioElement = new Audio();
  private playEl: HTMLAudioElement | null = null;
  private recorder: MediaRecorder | null = null;
  private recordTimer: number | null = null;
  private playUrl: string | null = null;
  private finishPlayback: (() => void) | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly deps: MicTestDeps,
    private readonly onError: (message: string | null) => void,
  ) {
    this.loopEl.autoplay = false;
    void setSink(this.loopEl, getSettings().outputDeviceId);
    this.unsubs.push(
      useSettings.subscribe((n, p) => this.onSettings(n, p)),
      // Ses kanalına girilirken mikrofon görüşmeye geçer; test (ve geri çalma) hemen kapanır.
      useVoice.subscribe((n) => {
        if (n.status !== 'idle') this.stop();
      }),
    );
    this.rebuild();
  }

  /** İşlenmiş mikrofonu anlık olarak çıkış aygıtına ver/verme. */
  setLoopback(on: boolean): void {
    this.loopback = on;
    this.syncLoopback();
  }

  /**
   * İşlenmiş mikrofonu MIC_TEST_RECORD_MS kaydeder, sonra çalar (kendi sesini yankısız duymak için).
   * Kayıt ve çalma sırasında anlık geri çalma susturulur.
   */
  async recordAndPlay(onPhase: (phase: MicTestPhase) => void): Promise<void> {
    if (this.stopped || this.phase) return;
    const setPhase = (phase: MicTestPhase): void => {
      this.phase = phase;
      this.syncLoopback();
      if (!this.stopped) onPhase(phase);
    };
    try {
      await this.queue;
      const track = this.processor?.processedTrack;
      if (this.stopped || !track) return;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(new MediaStream([track]));
      this.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const recorded = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      setPhase('recording');
      recorder.start();
      this.recordTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, MIC_TEST_RECORD_MS);
      await recorded;
      this.clearRecorder();
      if (this.stopped || !chunks.length) return;

      setPhase('playing');
      this.playUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      const el = new Audio(this.playUrl);
      this.playEl = el;
      await setSink(el, getSettings().outputDeviceId);
      await new Promise<void>((resolve) => {
        this.finishPlayback = resolve;
        el.onended = () => resolve();
        el.onerror = () => resolve();
        el.play().catch(() => resolve());
      });
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.clearRecorder();
      this.clearPlayback();
      setPhase(null);
    }
  }

  /** Testi durdurur; mikrofon, ses bağlamları, worklet'ler ve kayıt serbest bırakılır. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubs.splice(0).forEach((u) => u());
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.clearRecorder();
    this.clearPlayback();
    this.loopEl.pause();
    this.loopEl.srcObject = null;
    this.queue = this.queue.then(() => this.teardown());
    const s = getSettings();
    setVoice({
      micLevel: { db: -100, threshold: s.vadThresholdDb, open: false },
    });
  }

  /** Bas-konuş modunda testte kapı açık tutulur (kısayol yalnızca görüşmede çalışır). */
  private gate(): GateConfig {
    const g = this.deps.gateConfig();
    return g.mode === 'ptt' ? { ...g, mode: 'open' } : g;
  }

  private onSettings(n: Settings, p: Settings): void {
    if (this.stopped) return;
    if (n.inputMode !== p.inputMode || n.vadAuto !== p.vadAuto || n.vadThresholdDb !== p.vadThresholdDb) {
      this.processor?.updateGate(this.gate());
    }
    if (n.noiseStrengthDb !== p.noiseStrengthDb) this.processor?.setAttenLimit(n.noiseStrengthDb);
    if (n.inputVolume !== p.inputVolume) this.processor?.setInputGain(n.inputVolume);
    if (n.outputDeviceId !== p.outputDeviceId) {
      void setSink(this.loopEl, n.outputDeviceId);
      if (this.playEl) void setSink(this.playEl, n.outputDeviceId);
    }
    if (needsRebuild(n, p)) this.rebuild();
  }

  private rebuild(): void {
    this.queue = this.queue.then(async () => {
      await this.teardown();
      if (this.stopped) return;
      try {
        await this.build();
        if (!this.stopped) this.onError(null);
      } catch (err) {
        await this.teardown();
        const name = (err as Error)?.name;
        this.onError(
          name === 'NotAllowedError'
            ? 'Mikrofon izni verilmedi.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'Mikrofon bulunamadı; bir giriş aygıtı seç.'
              : `Mikrofon açılamadı: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.syncLoopback();
    });
  }

  private async open(denoiser: Denoiser | null): Promise<void> {
    const opts = this.deps.captureOptions(denoiser);
    const deviceId = getSettings().inputDeviceId;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
        echoCancellation: opts.echoCancellation,
        noiseSuppression: opts.noiseSuppression,
        autoGainControl: opts.autoGainControl,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    this.track = stream.getAudioTracks()[0] ?? null;
    if (!this.track) throw new Error('mikrofon izi yok');
    const processor = new MicProcessor(
      this.gate(),
      denoiser,
      getSettings().noiseStrengthDb,
      (level) => {
        if (!this.stopped && this.processor === processor) setVoice({ micLevel: level });
      },
      // Model çalışırken çökerse (ör. işlemci yetmedi) görüşmedeki gibi bir alt seçenekle yeniden kurulur
      () => {
        if (this.processor === processor) this.rebuild();
      },
    );
    processor.setInputGain(getSettings().inputVolume);
    this.processor = processor;
    await processor.init({
      kind: Track.Kind.Audio,
      track: this.track,
      audioContext: sharedAudioContext(),
    });
  }

  private async build(): Promise<void> {
    // DPDFNet kurulamazsa DeepFilterNet, o da olmazsa standart engelleme (görüşmedeki sırayla)
    for (let attempt = 0; attempt < 3 && !this.stopped; attempt++) {
      const denoiser = attempt < 2 ? await this.deps.wantedDenoiser() : null;
      await this.open(denoiser);
      if (!this.processor?.denoiserFailed) return;
      await this.teardown();
    }
  }

  private async teardown(): Promise<void> {
    const processor = this.processor;
    this.processor = null;
    // Zincir yeniden kurulursa (ayar değişti) süren kayıt eldekiyle biter
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.track?.stop();
    this.track = null;
    if (this.loopEl.srcObject) {
      this.loopEl.pause();
      this.loopEl.srcObject = null;
    }
    await processor?.destroy().catch(() => undefined);
  }

  /** Anlık geri çalma yalnızca istendiğinde ve kayıt/çalma yokken duyulur. */
  private syncLoopback(): void {
    const track = this.processor?.processedTrack;
    const want = this.loopback && !this.phase && !this.stopped && !!track;
    if (!want) {
      this.loopEl.pause();
      this.loopEl.srcObject = null;
      return;
    }
    const current = (this.loopEl.srcObject as MediaStream | null)?.getAudioTracks()[0];
    if (current !== track) this.loopEl.srcObject = new MediaStream([track!]);
    void this.loopEl.play().catch(() => undefined);
  }

  private clearRecorder(): void {
    if (this.recordTimer !== null) window.clearTimeout(this.recordTimer);
    this.recordTimer = null;
    this.recorder = null;
  }

  private clearPlayback(): void {
    if (this.playEl) {
      this.playEl.pause();
      this.playEl.removeAttribute('src');
      this.playEl.load();
      this.playEl = null;
    }
    if (this.playUrl) URL.revokeObjectURL(this.playUrl);
    this.playUrl = null;
    this.finishPlayback?.();
    this.finishPlayback = null;
  }
}
