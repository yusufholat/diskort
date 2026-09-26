import {
  createLocalAudioTrack,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type AudioCaptureOptions,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import type { VoiceJoinResponse } from '@diskort/shared';
import { api, errorMessage, useSession, gateway } from '@diskort/client-core';
import { bridge } from '../../lib/bridge';
import { playSound, sharedAudioContext } from '../../lib/sfx';
import { getSettings, useSettings, type Settings } from '../../stores/settings';
import { setVoice, useVoice, type MicLevel } from '../../stores/voice';
import { MicProcessor, type GateConfig } from './micProcessor';
import { SCREEN_PRESETS } from './screenPresets';
import type { ScreenCodec, ScreenContent, ScreenPresetId } from '../../stores/settings';

export interface ScreenShareOptions {
  /** Electron kaynak kimliği; tarayıcıda/macOS'ta sistem seçicisi kullanılır */
  sourceId?: string;
  preset: ScreenPresetId;
  codec: ScreenCodec;
  content: ScreenContent;
  audio: boolean;
}

const STATS_INTERVAL_MS = 2000;
const PREFETCH_TTL_MS = 60_000;

const RESET_ROOM_STATE = {
  speaking: {},
  streams: {},
  watching: {},
  focusedStream: null,
  pingMs: null,
  quality: 'unknown' as const,
  sharing: false,
  shareHasAudio: false,
  pttActive: false,
};

function disconnectMessage(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'Bu hesapla başka bir yerden ses kanalına bağlanıldı.';
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'Ses kanalından çıkarıldın.';
    case DisconnectReason.ROOM_DELETED:
      return 'Ses kanalı kapatıldı.';
    default:
      return 'Ses bağlantısı koptu.';
  }
}

/**
 * Ses motoru: LiveKit odasını, mikrofonu, ekran paylaşımını ve izlenen yayınları yönetir.
 * Arayüz yalnızca bu sınıfın metodlarını çağırır ve durumu `useVoice` store'undan okur.
 */
class VoiceClient {
  private room: Room | null = null;
  private mic: LocalAudioTrack | null = null;
  private processor: MicProcessor | null = null;
  private screen: { video: LocalVideoTrack; audio: LocalAudioTrack | null } | null = null;
  private statsTimer: number | null = null;
  private pttReleaseTimer: number | null = null;
  private joinSeq = 0;
  private remoteSpeaking = new Set<string>();
  private selfSpeaking = false;
  private prefetched: { channelId: string; at: number; response: Promise<VoiceJoinResponse> } | null = null;
  private readonly audioSink: HTMLDivElement;

  constructor() {
    this.audioSink = document.createElement('div');
    this.audioSink.hidden = true;
    document.body.appendChild(this.audioSink);

    useSettings.subscribe((next, prev) => this.onSettingsChanged(next, prev));
    gateway.on((msg) => {
      if (msg.t === 'READY') this.syncVoiceState();
    });
  }

  // ---------- Bağlanma / ayrılma ----------

  /** Fare kanalın üzerine gelince jetonu önceden al; tıklamada bir ağ gidiş-dönüşü kazanılır. */
  prefetch(channelId: string): void {
    const p = this.prefetched;
    if (p && p.channelId === channelId && Date.now() - p.at < PREFETCH_TTL_MS) return;
    if (useVoice.getState().channelId === channelId) return;
    const response = api.joinVoice(channelId);
    response.catch(() => {
      if (this.prefetched?.response === response) this.prefetched = null;
    });
    this.prefetched = { channelId, at: Date.now(), response };
  }

  private takePrefetched(channelId: string): Promise<VoiceJoinResponse> {
    const p = this.prefetched;
    this.prefetched = null;
    if (p && p.channelId === channelId && Date.now() - p.at < PREFETCH_TTL_MS) return p.response;
    return api.joinVoice(channelId);
  }

  async join(channelId: string): Promise<void> {
    const current = useVoice.getState();
    if (current.channelId === channelId && current.status !== 'idle') return;

    const seq = ++this.joinSeq;
    await this.teardownRoom();
    setVoice({ ...RESET_ROOM_STATE, channelId, status: 'connecting', error: null });

    try {
      const { url, token } = await this.takePrefetched(channelId);
      if (seq !== this.joinSeq) return;

      const s = getSettings();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        webAudioMix: true,
        audioOutput: { deviceId: s.outputDeviceId },
        publishDefaults: { dtx: true, red: true, stopMicTrackOnMute: false },
        disconnectOnPageLeave: true,
      });
      this.room = room;
      this.bindRoom(room);

      await room.connect(url, token, { autoSubscribe: false });
      if (seq !== this.joinSeq) {
        await room.disconnect();
        return;
      }

      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) this.onPublication(pub, p);
      }
      this.applyVolumes();
      setVoice({ status: 'connected' });
      playSound('join');
      this.startStats();
      this.syncVoiceState();
      await this.publishMic(room);
    } catch (err) {
      if (seq !== this.joinSeq) return;
      await this.teardownRoom();
      const message = errorMessage(err);
      setVoice({
        ...RESET_ROOM_STATE,
        channelId: null,
        status: 'idle',
        error: /pc connection|signal|websocket|fetch/i.test(message)
          ? 'Ses sunucusuna bağlanılamadı. Sunucu çalışıyor mu, UDP portları açık mı?'
          : message,
      });
    }
  }

  async leave(): Promise<void> {
    this.joinSeq++;
    const wasActive = useVoice.getState().status !== 'idle';
    await this.teardownRoom();
    setVoice({ ...RESET_ROOM_STATE, channelId: null, status: 'idle' });
    if (wasActive) playSound('leave');
  }

  clearError(): void {
    setVoice({ error: null });
  }

  private async teardownRoom(): Promise<void> {
    this.stopStats();
    if (this.pttReleaseTimer !== null) window.clearTimeout(this.pttReleaseTimer);
    this.pttReleaseTimer = null;
    const room = this.room;
    this.room = null;
    await this.stopScreenShareInternal(room, false);
    if (room) await room.disconnect(true).catch(() => undefined);
    this.mic?.stop();
    await this.processor?.destroy().catch(() => undefined);
    this.mic = null;
    this.processor = null;
    this.remoteSpeaking.clear();
    this.selfSpeaking = false;
    this.audioSink.replaceChildren();
  }

  // ---------- Mikrofon ----------

  private captureOptions(): AudioCaptureOptions {
    const s = getSettings();
    return {
      deviceId: s.inputDeviceId,
      echoCancellation: s.echoCancellation,
      // RNNoise açıkken tarayıcının gürültü engelleyicisi kapatılır (çift işlem sesi bozar).
      noiseSuppression: s.noise === 'standard',
      autoGainControl: s.autoGainControl,
      channelCount: 1,
      sampleRate: 48000,
    };
  }

  private gateConfig(): GateConfig {
    const s = getSettings();
    return {
      mode: s.inputMode === 'ptt' ? 'ptt' : 'vad',
      auto: s.vadAuto,
      threshold: s.vadThresholdDb,
      ptt: useVoice.getState().pttActive,
    };
  }

  private async publishMic(room: Room): Promise<void> {
    const s = getSettings();
    let track: LocalAudioTrack | null = null;
    try {
      track = await createLocalAudioTrack(this.captureOptions());
      track.setAudioContext(sharedAudioContext());
      const processor = new MicProcessor(this.gateConfig(), s.noise === 'rnnoise', (level) =>
        this.onMicLevel(level),
      );
      await track.setProcessor(processor);
      if (s.selfMute || s.selfDeaf) await track.mute();
      if (room !== this.room) {
        track.stop();
        await processor.destroy();
        return;
      }
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
        dtx: true,
        red: true,
        audioPreset: { maxBitrate: s.audioBitrateKbps * 1000 },
      });
      this.mic = track;
      this.processor = processor;
    } catch (err) {
      track?.stop();
      const name = (err as Error)?.name;
      setVoice({
        error:
          name === 'NotAllowedError'
            ? 'Mikrofon izni verilmedi. Sistem ayarlarından Diskort için mikrofon erişimini aç.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'Mikrofon bulunamadı. Ayarlar > Ses bölümünden bir giriş aygıtı seç.'
              : `Mikrofon açılamadı: ${errorMessage(err)}`,
      });
    }
  }

  /** Gürültü engelleme vb. değişince mikrofonu yeni ayarlarla yeniden yayınla. */
  private async republishMic(): Promise<void> {
    const room = this.room;
    if (!room || useVoice.getState().status !== 'connected') return;
    const old = this.mic;
    const oldProcessor = this.processor;
    this.mic = null;
    this.processor = null;
    if (old) {
      await room.localParticipant.unpublishTrack(old, true).catch(() => undefined);
      old.stop();
    }
    await oldProcessor?.destroy().catch(() => undefined);
    await this.publishMic(room);
  }

  private onMicLevel(level: MicLevel): void {
    const s = getSettings();
    const speaking = level.open && !s.selfMute && !s.selfDeaf && this.mic !== null;
    const prev = useVoice.getState().micLevel;
    if (Math.abs(prev.db - level.db) > 0.5 || prev.open !== level.open || prev.threshold !== level.threshold) {
      setVoice({ micLevel: level });
    }
    if (speaking !== this.selfSpeaking) {
      this.selfSpeaking = speaking;
      this.publishSpeaking();
    }
  }

  // ---------- Mute / deafen / bas-konuş ----------

  toggleMute(): void {
    const s = getSettings();
    if (s.selfDeaf) {
      s.set({ selfDeaf: false, selfMute: false });
      playSound('undeafen');
      return;
    }
    s.set({ selfMute: !s.selfMute });
    playSound(s.selfMute ? 'unmute' : 'mute');
  }

  toggleDeafen(): void {
    const s = getSettings();
    if (s.selfDeaf) {
      s.set({ selfDeaf: false });
      playSound('undeafen');
    } else {
      playSound('deafen');
      s.set({ selfDeaf: true });
    }
  }

  setPushToTalk(pressed: boolean): void {
    if (getSettings().inputMode !== 'ptt') return;
    if (this.pttReleaseTimer !== null) window.clearTimeout(this.pttReleaseTimer);
    this.pttReleaseTimer = null;
    if (pressed) {
      this.applyPtt(true);
    } else {
      this.pttReleaseTimer = window.setTimeout(() => this.applyPtt(false), getSettings().pttReleaseMs);
    }
  }

  private applyPtt(active: boolean): void {
    if (useVoice.getState().pttActive === active) return;
    setVoice({ pttActive: active });
    this.processor?.updateGate({ ptt: active });
  }

  private applyMicMute(): void {
    const s = getSettings();
    if (!this.mic) return;
    if (s.selfMute || s.selfDeaf) void this.mic.mute();
    else void this.mic.unmute();
  }

  private applyVolumes(): void {
    const room = this.room;
    if (!room) return;
    const s = getSettings();
    for (const p of room.remoteParticipants.values()) {
      const silenced = s.selfDeaf || s.localMutes[p.identity] === true;
      p.setVolume(silenced ? 0 : (s.userVolumes[p.identity] ?? 1), Track.Source.Microphone);
      p.setVolume(s.selfDeaf ? 0 : (s.streamVolumes[p.identity] ?? 1), Track.Source.ScreenShareAudio);
    }
  }

  private syncVoiceState(): void {
    const s = getSettings();
    gateway.send({ t: 'VOICE_STATE_SET', d: { selfMute: s.selfMute, selfDeaf: s.selfDeaf } });
  }

  private onSettingsChanged(next: Settings, prev: Settings): void {
    if (next.selfMute !== prev.selfMute || next.selfDeaf !== prev.selfDeaf) {
      this.applyMicMute();
      this.applyVolumes();
      this.syncVoiceState();
      if (this.selfSpeaking && (next.selfMute || next.selfDeaf)) {
        this.selfSpeaking = false;
        this.publishSpeaking();
      }
    }
    if (
      next.userVolumes !== prev.userVolumes ||
      next.localMutes !== prev.localMutes ||
      next.streamVolumes !== prev.streamVolumes
    ) {
      this.applyVolumes();
    }
    if (
      next.inputMode !== prev.inputMode ||
      next.vadAuto !== prev.vadAuto ||
      next.vadThresholdDb !== prev.vadThresholdDb
    ) {
      if (next.inputMode !== 'ptt') this.applyPtt(false);
      this.processor?.updateGate(this.gateConfig());
    }
    if (next.outputDeviceId !== prev.outputDeviceId) {
      void this.room?.switchActiveDevice('audiooutput', next.outputDeviceId).catch(() => undefined);
    }
    if (
      next.inputDeviceId !== prev.inputDeviceId ||
      next.noise !== prev.noise ||
      next.echoCancellation !== prev.echoCancellation ||
      next.autoGainControl !== prev.autoGainControl ||
      next.audioBitrateKbps !== prev.audioBitrateKbps
    ) {
      void this.republishMic();
    }
  }

  // ---------- Oda olayları ----------

  private bindRoom(room: Room): void {
    room
      .on(RoomEvent.TrackPublished, (pub, p) => this.onPublication(pub, p))
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
          this.refreshStream(p);
        }
      })
      .on(RoomEvent.TrackSubscribed, (track, _pub, _p) => this.onSubscribed(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        this.bumpTracks();
      })
      .on(RoomEvent.ParticipantConnected, () => {
        this.applyVolumes();
        playSound('userJoin');
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.remoteSpeaking.delete(p.identity);
        this.publishSpeaking();
        this.refreshStream(p);
        playSound('userLeave');
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.remoteSpeaking = new Set(speakers.filter((sp) => !sp.isLocal).map((sp) => sp.identity));
        this.publishSpeaking();
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality, p) => {
        if (p.isLocal) setVoice({ quality });
      })
      .on(RoomEvent.Reconnecting, () => {
        if (room === this.room) setVoice({ status: 'reconnecting' });
      })
      .on(RoomEvent.Reconnected, () => {
        if (room === this.room) setVoice({ status: 'connected' });
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined);
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== this.room) return; // kendi başlattığımız ayrılma
        this.joinSeq++;
        void this.teardownRoom();
        setVoice({ ...RESET_ROOM_STATE, channelId: null, status: 'idle', error: disconnectMessage(reason) });
        playSound('leave');
      });
  }

  private onPublication(pub: RemoteTrackPublication, p: RemoteParticipant): void {
    if (pub.source === Track.Source.Microphone) {
      pub.setSubscribed(true);
      return;
    }
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
      this.refreshStream(p);
      if (useVoice.getState().watching[p.identity]) pub.setSubscribed(true);
    }
  }

  private onSubscribed(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Audio) this.audioSink.appendChild(track.attach());
    this.applyVolumes();
    this.bumpTracks();
  }

  private refreshStream(p: RemoteParticipant): void {
    const video = p.getTrackPublication(Track.Source.ScreenShare);
    const audio = p.getTrackPublication(Track.Source.ScreenShareAudio);
    const id = p.identity;
    setVoice((s) => {
      const streams = { ...s.streams };
      const watching = { ...s.watching };
      let focusedStream = s.focusedStream;
      if (video) {
        streams[id] = { hasAudio: Boolean(audio) };
      } else {
        delete streams[id];
        delete watching[id];
        if (focusedStream === id) focusedStream = Object.keys(watching)[0] ?? null;
      }
      return { streams, watching, focusedStream };
    });
  }

  private publishSpeaking(): void {
    const speaking: Record<string, true> = {};
    for (const id of this.remoteSpeaking) speaking[id] = true;
    const selfId = useSession.getState().user?.id;
    if (this.selfSpeaking && selfId) speaking[selfId] = true;
    setVoice({ speaking });
  }

  private bumpTracks(): void {
    setVoice((s) => ({ tracksVersion: s.tracksVersion + 1 }));
  }

  // ---------- Yayın izleme ----------

  watchStream(userId: string): void {
    setVoice((s) => ({ watching: { ...s.watching, [userId]: true }, focusedStream: userId }));
    const p = this.room?.remoteParticipants.get(userId);
    p?.getTrackPublication(Track.Source.ScreenShare)?.setSubscribed(true);
    p?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(true);
  }

  stopWatching(userId: string): void {
    const p = this.room?.remoteParticipants.get(userId);
    p?.getTrackPublication(Track.Source.ScreenShare)?.setSubscribed(false);
    p?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(false);
    setVoice((s) => {
      const { [userId]: _removed, ...watching } = s.watching;
      const focusedStream = s.focusedStream === userId ? (Object.keys(watching)[0] ?? null) : s.focusedStream;
      return { watching, focusedStream };
    });
  }

  focusStream(userId: string | null): void {
    setVoice({ focusedStream: userId });
  }

  /** Yayın görüntüsü: uzak kullanıcılar için abone olunan track, kendin için yerel önizleme. */
  getScreenTrack(userId: string): RemoteVideoTrack | LocalVideoTrack | undefined {
    const selfId = useSession.getState().user?.id;
    if (userId === selfId) return this.screen?.video;
    const pub = this.room?.remoteParticipants.get(userId)?.getTrackPublication(Track.Source.ScreenShare);
    return pub?.videoTrack as RemoteVideoTrack | undefined;
  }

  // ---------- Ekran paylaşımı ----------

  /** Yayını başlatır; sistem sesi paylaşılamadıysa uyarı metni döner. */
  async startScreenShare(opts: ScreenShareOptions): Promise<string | null> {
    const room = this.room;
    if (!room || useVoice.getState().status !== 'connected') return null;
    await this.stopScreenShareInternal(room, false);

    const preset = SCREEN_PRESETS[opts.preset];
    if (bridge && opts.sourceId) await bridge.screen.select({ sourceId: opts.sourceId, audio: opts.audio });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.fps, max: preset.fps },
        },
        audio: opts.audio
          ? ({
              // Uygulamanın kendi sesini (diğer konuşmacılar) hariç tut → yankı olmaz.
              restrictOwnAudio: true,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } as MediaTrackConstraints)
          : false,
        selfBrowserSurface: 'exclude',
        systemAudio: opts.audio ? 'include' : 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError' || (err as Error).name === 'AbortError') return null;
      throw err;
    }
    if (room !== this.room) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }

    const videoTrack = stream.getVideoTracks()[0]!;
    videoTrack.contentHint = opts.content;
    let audioTrack = stream.getAudioTracks()[0];
    let warning: string | null = null;
    if (audioTrack) {
      const settings = audioTrack.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean };
      if (settings.restrictOwnAudio === false) {
        audioTrack.stop();
        audioTrack = undefined;
        warning = 'Sistem sesi bu sistemde yankısız paylaşılamadığı için kapatıldı.';
      }
    } else if (opts.audio && bridge?.screen.supportsAudio) {
      warning = 'Sistem sesi yakalanamadı; yayın sessiz devam ediyor.';
    }

    const video = new LocalVideoTrack(videoTrack, undefined, true);
    await room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      videoCodec: opts.codec,
      backupCodec: false,
      simulcast: false,
      screenShareEncoding: { maxBitrate: preset.bitrate, maxFramerate: preset.fps, priority: 'high' },
      degradationPreference: opts.content === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
    });

    let audio: LocalAudioTrack | null = null;
    if (audioTrack) {
      audio = new LocalAudioTrack(audioTrack, undefined, true);
      await room.localParticipant.publishTrack(audio, {
        source: Track.Source.ScreenShareAudio,
        dtx: false,
        red: false,
        forceStereo: true,
        audioPreset: { maxBitrate: 128_000 },
      });
    }

    this.screen = { video, audio };
    // Paylaşılan pencere kapanırsa veya sistemden durdurulursa yayını bitir.
    videoTrack.addEventListener('ended', () => void this.stopScreenShare());
    setVoice({ sharing: true, shareHasAudio: audio !== null });
    this.bumpTracks();
    playSound('streamStart');
    return warning;
  }

  async stopScreenShare(): Promise<void> {
    await this.stopScreenShareInternal(this.room, true);
  }

  private async stopScreenShareInternal(room: Room | null, withSound: boolean): Promise<void> {
    const screen = this.screen;
    if (!screen) return;
    this.screen = null;
    for (const track of [screen.video, screen.audio]) {
      if (!track) continue;
      if (room) await room.localParticipant.unpublishTrack(track, true).catch(() => undefined);
      track.stop();
    }
    setVoice({ sharing: false, shareHasAudio: false });
    this.bumpTracks();
    if (withSound) playSound('streamStop');
  }

  // ---------- İstatistik ----------

  private startStats(): void {
    this.stopStats();
    this.statsTimer = window.setInterval(() => void this.collectStats(), STATS_INTERVAL_MS);
    void this.collectStats();
  }

  private stopStats(): void {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private async collectStats(): Promise<void> {
    const report = await this.mic?.getRTCStatsReport().catch(() => undefined);
    let rtt: number | null = null;
    report?.forEach((stat: { type: string; nominated?: boolean; currentRoundTripTime?: number }) => {
      if (stat.type === 'candidate-pair' && stat.nominated && typeof stat.currentRoundTripTime === 'number') {
        rtt = Math.round(stat.currentRoundTripTime * 1000);
      }
    });
    if (rtt !== null || !this.mic) setVoice({ pingMs: rtt });
  }

  // ---------- Mikrofon testi (ayarlar ekranı) ----------

  /** Ses kanalında değilken ayarlarda mikrofon seviyesini göstermek için geçici işlem zinciri. */
  async startMicTest(loopback: boolean): Promise<() => void> {
    if (this.processor) return () => undefined; // bağlıyken canlı seviye zaten akıyor
    const s = getSettings();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.inputDeviceId === 'default' ? undefined : { exact: s.inputDeviceId },
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noise === 'standard',
        autoGainControl: s.autoGainControl,
        channelCount: 1,
      },
    });
    const track = stream.getAudioTracks()[0]!;
    const processor = new MicProcessor(this.gateConfig(), s.noise === 'rnnoise', (level) =>
      setVoice({ micLevel: level }),
    );
    await processor.init({ kind: Track.Kind.Audio, track, audioContext: sharedAudioContext() });

    let audioEl: HTMLAudioElement | null = null;
    if (loopback && processor.processedTrack) {
      audioEl = new Audio();
      audioEl.srcObject = new MediaStream([processor.processedTrack]);
      const sinkable = audioEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (s.outputDeviceId !== 'default') await sinkable.setSinkId?.(s.outputDeviceId).catch(() => undefined);
      void audioEl.play();
    }
    const unsub = useSettings.subscribe((n, p) => {
      if (n.inputMode !== p.inputMode || n.vadAuto !== p.vadAuto || n.vadThresholdDb !== p.vadThresholdDb) {
        processor.updateGate({ mode: n.inputMode === 'ptt' ? 'ptt' : 'vad', auto: n.vadAuto, threshold: n.vadThresholdDb });
      }
    });

    return () => {
      unsub();
      audioEl?.pause();
      track.stop();
      void processor.destroy();
      setVoice({ micLevel: { db: -100, threshold: s.vadThresholdDb, open: false } });
    };
  }
}

export const voice = new VoiceClient();
