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
  /**
   * Görüşmedeki canlı mikrofon zincirinin dinleme kolu (odaya gitmez). 'pending': görüşmede mikrofon
   * (yeniden) kuruluyor, beklenir. null: görüşmede değilsin ya da mikrofon yayınlanmıyor (ör. sunucuda
   * susturuldun); test kendi zincirini kurar.
   */
  liveTrack(): MediaStreamTrack | 'pending' | null;
  /** Test bitti (odadaki susturma kaldırılır) */
  onStop(): void;
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
 * otomatik kazanç, gürültü engelleme + gücü, ses kapısı). İstenirse işlenmiş sesi seçili çıkış aygıtından geri
 * çalar ya da 5 sn kaydedip dinletir. Ayar değişiklikleri test sürerken uygulanır.
 *
 * Görüşmede değilken kendi zincirini kurar ve seviye göstergesini besler. Görüşmedeyken ikinci bir mikrofon ve
 * gürültü engelleyici açılmaz: canlı zincirin odaya gitmeyen dinleme kolu çalınır (voiceClient test sürerken
 * odaya sessizlik gönderir ve seni susturulmuş gösterir). Görüşmeye girilir/çıkılırsa test kaynağını değiştirip
 * sürer.
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
  private recordingTrack: MediaStreamTrack | null = null;
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
      // Görüşmeye girildi/çıkıldı ya da konuşma izni değişti: kaynak (canlı zincir / kendi zinciri) yeniden seçilir
      useVoice.subscribe((n, p) => {
        if ((n.status === 'idle') !== (p.status === 'idle') || n.micAllowed !== p.micAllowed) this.liveChanged();
      }),
    );
    this.sync(false);
  }

  /** Görüşmedeki mikrofon zinciri değişti (yayınlandı, yeniden kuruldu, kaldırıldı). */
  liveChanged(): void {
    if (this.stopped) return;
    const track = this.currentTrack();
    // Kaydedilen iz bittiyse kayıt eldekiyle biter
    if (this.recorder && this.recorder.state !== 'inactive' && this.recordingTrack !== track) this.recorder.stop();
    this.sync(false);
  }

  /** Görüşmedeki canlı zincirin dinleme kolu kullanılıyor mu (ya da onu mu bekliyoruz) */
  private get live(): boolean {
    return this.deps.liveTrack() !== null;
  }

  private currentTrack(): MediaStreamTrack | undefined {
    const live = this.deps.liveTrack();
    if (live === 'pending') return undefined;
    return live ?? this.processor?.processedTrack;
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
      const track = this.currentTrack();
      if (this.stopped || !track) return;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(new MediaStream([track]));
      this.recorder = recorder;
      this.recordingTrack = track;
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
    const ownChain = !this.live;
    this.queue = this.queue.then(() => this.teardown());
    this.deps.onStop();
    // Görüşmedeyken gösterge canlı mikrofonu göstermeye devam eder
    if (ownChain) setVoice({ micLevel: { db: -100, threshold: getSettings().vadThresholdDb, open: false } });
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
    if (n.outputDeviceId !== p.outputDeviceId) {
      void setSink(this.loopEl, n.outputDeviceId);
      if (this.playEl) void setSink(this.playEl, n.outputDeviceId);
    }
    // Görüşmedeyken canlı zinciri voiceClient yeniden kurar (liveChanged ile haber verir)
    if (needsRebuild(n, p) && !this.live) this.sync(true);
  }

  /**
   * Kaynağı seçer: canlı zincir varsa (ya da kuruluyorsa) kendi zinciri kapatılır; yoksa kendi zinciri kurulur
   * (rebuild: ayar değişti, zincir baştan kurulur).
   */
  private sync(rebuild: boolean): void {
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      if (this.live) {
        await this.teardown();
        if (!this.stopped) this.onError(null);
        this.syncLoopback();
        return;
      }
      if (this.processor && !rebuild) {
        this.syncLoopback();
        return;
      }
      await this.teardown();
      if (this.stopped || this.live) return;
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
        if (this.processor === processor) this.sync(true);
      },
    );
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
    if (processor && this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.track?.stop();
    this.track = null;
    if (processor && this.loopEl.srcObject) {
      this.loopEl.pause();
      this.loopEl.srcObject = null;
    }
    await processor?.destroy().catch(() => undefined);
  }

  /** Anlık geri çalma yalnızca istendiğinde ve kayıt/çalma yokken duyulur. */
  private syncLoopback(): void {
    const track = this.currentTrack();
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
    this.recordingTrack = null;
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
