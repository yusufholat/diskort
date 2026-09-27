import {
  createLocalAudioTrack,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  LogLevel,
  Room,
  RoomEvent,
  setLogExtension,
  Track,
  type AudioCaptureOptions,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import type { VoiceJoinResponse } from '@diskort/shared';
import {
  api,
  ChannelSoundGate,
  describeTransport,
  errorMessage,
  gateway,
  linkQuality,
  outboundDelta,
  parseTransportStats,
  pushSample,
  reportClientError,
  reportVoiceLog,
  SpuriousDuplicateGuard,
  summarizePings,
  useGuild,
  useSession,
  type TransportStats,
} from '@diskort/client-core';
import { bridge } from '../../lib/bridge';
import { playSound, prepareSounds, sharedAudioContext } from '../../lib/sfx';
import { getSettings, useSettings, type Settings } from '../../stores/settings';
import { setVoice, useVoice, type MicLevel } from '../../stores/voice';
import {
  EMPTY_CONNECTION_STATS,
  setConnectionStats,
  useConnectionStats,
  type StreamLabel,
  type VoiceServerInfo,
} from '../../stores/connectionStats';
import {
  deepFilterAvailable,
  dpdfnetAvailable,
  MicProcessor,
  type Denoiser,
  type GateConfig,
  type MicProcessingStats,
} from './micProcessor';
import { prepareHardwareEncoder, releaseHardwareEncoder, type HwEncoderChoice } from './hardwareEncoder';
import { SCREEN_PRESETS } from './screenPresets';
import { MicTest } from './micTest';
import { StreamPreviewUploader } from './streamPreviewUploader';
import type { ScreenCodec, ScreenContent, ScreenPresetId } from '../../stores/settings';

export interface ScreenShareOptions {
  /** Electron kaynak kimliği; tarayıcıda/macOS'ta sistem seçicisi kullanılır */
  sourceId?: string;
  preset: ScreenPresetId;
  codec: ScreenCodec;
  content: ScreenContent;
  audio: boolean;
  /** Seçilen pencerenin/ekranın adı ("Şimdi Yayın Yapıyor" kartında görünür) */
  sourceName?: string;
  sourceKind?: 'screen' | 'window';
}

const STATS_INTERVAL_MS = 2000;
/** Etiket/simge rengi son bu kadar sürenin ping ve kaybına göre belirlenir */
const QUALITY_WINDOW_MS = 10_000;
const PREFETCH_TTL_MS = 60_000;
/** Yeniden bağlanma bu süreyi aşarsa "bağlantı koptu" sesi çalınır; geri gelince "geri geldi" */
const RECONNECT_SOUND_DELAY_MS = 2500;

/** LiveKit protokolündeki kaynak numaraları (ParticipantPermission.canPublishSources) */
const PROTO_SOURCE = { microphone: 2, screenShare: 3 } as const;

const RESET_ROOM_STATE = {
  micAllowed: true,
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

/** Paylaşılan kaynağın adı; sistem seçicisinde (macOS/tarayıcı) ad bilinmez, türü yazılır */
function sourceOf(opts: ScreenShareOptions, track: MediaStreamTrack): { name: string; kind: 'screen' | 'window' } {
  if (opts.sourceName && opts.sourceKind) return { name: opts.sourceName, kind: opts.sourceKind };
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  if (surface === 'monitor') return { name: 'Ekran', kind: 'screen' };
  return { name: surface === 'browser' ? 'Tarayıcı sekmesi' : 'Pencere', kind: 'window' };
}

/**
 * Mikrofon testi bitince odaya gönderim bu kadar gecikmeyle açılır: susturma/bas-konuş kapısı yeniden
 * uygulandıktan sonra zincirde (gürültü engelleyici gecikmesi + tamponlar) kalan test sesi odaya sızmasın.
 */
const MIC_TEST_RESUME_SEND_MS = 300;

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
  private screen: { video: LocalVideoTrack; audio: LocalAudioTrack | null; preview: StreamPreviewUploader } | null = null;
  /** Yayında istenen donanım kodlama yolu (null: ekran kartı kodlayıcısı yok, Chromium'un varsayılanı) */
  screenHardwareEncoder: HwEncoderChoice | null = null;
  private statsTimer: number | null = null;
  /** Bir önceki istatistik ölçümü (bit hızı ve kayıp farkları için) */
  private statsPrev: { publisher: TransportStats | null; subscriber: TransportStats | null } = {
    publisher: null,
    subscriber: null,
  };
  private statsBusy = false;
  /** Açık bağlantı paneli sayısı; açıkken ayrıntılı istatistikler de toplanır */
  private detailWatchers = 0;
  private pttReleaseTimer: number | null = null;
  private joinSeq = 0;
  private readonly duplicates = new SpuriousDuplicateGuard();
  private remoteSpeaking = new Set<string>();
  private selfSpeaking = false;
  /** Katılırken ya da izin gelince mikrofon yayınlanıyor (iki kez yayınlanmasın) */
  private micStarting = false;
  /** Görüşmede mikrofon açılamadı (izin yok, aygıt yok); mikrofon testi kendi zincirini dener */
  private micFailed = false;
  /** Ayarlardaki mikrofon testi; görüşmedeyken sürdükçe odaya sessizlik gider ve susturulmuş görünürsün */
  private micTest: MicTest | null = null;
  private resumeSendTimer: number | null = null;
  private prefetched: { channelId: string; at: number; response: Promise<VoiceJoinResponse> } | null = null;
  private readonly audioSink: HTMLDivElement;
  /** Başkalarının kanal olaylarının sesleri (bağlanınca sel olmasın, art arda gelenler tek ses) */
  private readonly channelSounds = new ChannelSoundGate((name) => playSound(name));
  /** Bağlantı kısa süre içinde geri gelmezse "koptu" sesi; geri gelince "geri geldi" */
  private reconnectTimer: number | null = null;
  private lostSoundPlayed = false;

  constructor() {
    this.audioSink = document.createElement('div');
    this.audioSink.hidden = true;
    document.body.appendChild(this.audioSink);

    useSettings.subscribe((next, prev) => this.onSettingsChanged(next, prev));
    gateway.on((msg) => {
      if (msg.t === 'READY') this.syncVoiceState();
      // Yetkili biri seni başka ses kanalına taşıdı: o kanala geç
      if (msg.t === 'VOICE_MOVE' && useVoice.getState().channelId) void this.join(msg.d.channelId);
    });
    // Sunucuda sağırlaştırılınca kimse duyulmaz (dinleme LiveKit'te kesilmez, istemci uygular)
    useGuild.subscribe((next, prev) => {
      const selfId = useSession.getState().user?.id;
      if (!selfId) return;
      const now = next.voiceStates[selfId];
      const before = prev.voiceStates[selfId];
      if (now?.serverDeaf !== before?.serverDeaf) this.applyVolumes();
      // Yetkili biri seni sunucuda susturdu / sağırlaştırdı (ya da kaldırdı): kendi düğmendeki gibi ses
      if (now && before && useVoice.getState().status === 'connected') {
        if (now.serverDeaf !== before.serverDeaf) playSound(now.serverDeaf ? 'deafen' : 'undeafen');
        else if (now.serverMute !== before.serverMute) playSound(now.serverMute ? 'mute' : 'unmute');
      }
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

  /** @param opts.silent Sessiz geri dönüş ("başka cihaz" uyarısından sonra): katılma sesi çalınmaz */
  async join(channelId: string, opts: { silent?: boolean } = {}): Promise<void> {
    const current = useVoice.getState();
    if (current.channelId === channelId && current.status !== 'idle') return;

    const seq = ++this.joinSeq;
    // Ses bağlamı ve çıkış aygıtı bağlanırken hazırlanır: "katıldın" sesi aygıt değişimine takılmasın
    prepareSounds();
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
      // Bağlanırken gelen katılımcı/yayın olayları ses çıkarmaz (süre bağlanınca kısaltılır)
      this.channelSounds.quiet(60_000);

      await room.connect(url, token, { autoSubscribe: false });
      if (seq !== this.joinSeq) {
        await room.disconnect();
        return;
      }

      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) this.onPublication(pub, p);
      }
      this.applyVolumes();
      setConnectionStats({ server: this.serverInfo(room, url) });
      setVoice({ status: 'connected', micAllowed: this.canPublish(room, PROTO_SOURCE.microphone) });
      // Bağlantı kurulunca (öncesinde değil) çalınır; kanaldakilerin girişleri ve yayınları ses seli yapmaz
      this.channelSounds.quiet();
      if (!opts.silent) playSound('join');
      this.startStats();
      this.syncVoiceState();
      await this.startMic(room);
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

  async leave(opts: { silent?: boolean } = {}): Promise<void> {
    this.joinSeq++;
    const wasActive = useVoice.getState().status !== 'idle';
    await this.teardownRoom();
    setVoice({ ...RESET_ROOM_STATE, channelId: null, status: 'idle' });
    if (wasActive && !opts.silent) playSound('leave');
  }

  clearError(): void {
    setVoice({ error: null });
  }

  private async teardownRoom(): Promise<void> {
    this.channelSounds.cancel();
    this.clearReconnectTimer();
    this.stopStats();
    this.statsPrev = { publisher: null, subscriber: null };
    setConnectionStats(EMPTY_CONNECTION_STATS);
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
    this.micFailed = false;
    this.micTest?.liveChanged();
    this.remoteSpeaking.clear();
    this.selfSpeaking = false;
    this.audioSink.replaceChildren();
  }

  // ---------- Mikrofon ----------

  /**
   * @param denoiser Zincirde çalışacak yapay zekâ gürültü engelleyicisi. Çalışırken tarayıcının gürültü
   * engelleyicisi kapatılır (çift işlem sesi bozar); hiçbiri yüklenemezse standart engelleme devreye girer.
   */
  private captureOptions(denoiser: Denoiser | null): AudioCaptureOptions {
    const s = getSettings();
    const wantsAi = s.noise === 'deepfilter' || s.noise === 'dpdfnet';
    return {
      deviceId: s.inputDeviceId,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noise === 'standard' || (wantsAi && !denoiser),
      autoGainControl: s.autoGainControl,
      channelCount: 1,
      sampleRate: 48000,
    };
  }

  /**
   * Ayardaki yapay zekâ gürültü engelleyicisinin dosyalarını önceden yükler. DPDFNet kullanılamıyorsa
   * (yüklenemedi, işlemci yetmedi) DeepFilterNet'e, o da olmazsa standart engellemeye (null) düşülür.
   */
  private async wantedDenoiser(): Promise<Denoiser | null> {
    const noise = getSettings().noise;
    if (noise === 'dpdfnet' && (await dpdfnetAvailable())) return 'dpdfnet';
    if ((noise === 'dpdfnet' || noise === 'deepfilter') && (await deepFilterAvailable())) return 'deepfilter';
    return null;
  }

  /** Mikrofon işleme ölçümleri (gürültü engelleyici yükü, kare süreleri); bağlı değilse null */
  micProcessingStats(): MicProcessingStats | null {
    return this.processor?.stats ?? null;
  }

  private gateConfig(): GateConfig {
    const s = getSettings();
    return {
      // Test sürerken bas-konuş kapısı açık tutulur (odaya zaten sessizlik gider), kendini tuşsuz duyarsın
      mode: s.inputMode === 'ptt' ? (this.micTest ? 'open' : 'ptt') : 'vad',
      auto: s.vadAuto,
      threshold: s.vadThresholdDb,
      ptt: useVoice.getState().pttActive,
    };
  }

  /**
   * LiveKit bu kaynağı yayınlamaya izin veriyor mu. Sunucu izni kanaldaki yetkilere göre verir
   * (SPEAK → mikrofon, STREAM → ekran) ve sunucuda susturulunca mikrofon iznini alır.
   */
  private canPublish(room: Room, source: number): boolean {
    const p = room.localParticipant.permissions;
    if (!p) return true;
    return p.canPublish && (p.canPublishSources.length === 0 || p.canPublishSources.includes(source as never));
  }

  /** Mikrofon açılamıyorsa kullanıcıya gösterilecek neden */
  micBlockedReason(): string {
    const selfId = useSession.getState().user?.id;
    const state = selfId ? useGuild.getState().voiceStates[selfId] : undefined;
    return state?.serverMute || state?.serverDeaf
      ? 'Sunucuda susturuldun; mikrofonunu yalnızca yetkili biri açabilir.'
      : 'Bu kanalda konuşma iznin yok.';
  }

  /** İzinler değişti (rol, kanal izni, sunucuda susturma): mikrofonu ve yayını ona göre aç/kapat. */
  private async onPermissionsChanged(room: Room): Promise<void> {
    const micAllowed = this.canPublish(room, PROTO_SOURCE.microphone);
    setVoice({ micAllowed });
    if (!micAllowed && this.mic) {
      const old = this.mic;
      const oldProcessor = this.processor;
      this.mic = null;
      this.processor = null;
      this.micTest?.liveChanged();
      await room.localParticipant.unpublishTrack(old, true).catch(() => undefined);
      old.stop();
      await oldProcessor?.destroy().catch(() => undefined);
      if (this.selfSpeaking) {
        this.selfSpeaking = false;
        this.publishSpeaking();
      }
    } else if (micAllowed && !this.mic && useVoice.getState().status === 'connected') {
      await this.startMic(room);
    }
    if (this.screen && !this.canPublish(room, PROTO_SOURCE.screenShare)) await this.stopScreenShare();
  }

  private async startMic(room: Room): Promise<void> {
    if (this.micStarting) return;
    this.micStarting = true;
    try {
      await this.publishMic(room);
    } finally {
      this.micStarting = false;
    }
  }

  private async publishMic(room: Room): Promise<void> {
    // Konuşma izni yoksa (ya da sunucuda susturulduysa) yalnızca dinlenir; izin gelince yayınlanır
    if (!this.canPublish(room, PROTO_SOURCE.microphone)) return;
    const s = getSettings();
    this.micFailed = false;
    let track: LocalAudioTrack | null = null;
    try {
      const denoiser = await this.wantedDenoiser();
      track = await createLocalAudioTrack(this.captureOptions(denoiser));
      track.setAudioContext(sharedAudioContext());
      const processor = new MicProcessor(
        this.gateConfig(),
        denoiser,
        getSettings().noiseStrengthDb,
        (level) => this.onMicLevel(level),
        () => void this.republishMic(),
      );
      // Mikrofon testi sürüyorsa odaya daha ilk andan sessizlik gider
      processor.setSendMuted(this.micTest !== null || this.resumeSendTimer !== null);
      processor.onRebuilt = () => {
        if (this.processor === processor) this.micTest?.liveChanged();
      };
      await track.setProcessor(processor);
      // Gürültü engelleyici kurulamadıysa mikrofonu tarayıcının gürültü engellemesiyle yeniden aç
      if (processor.denoiserFailed) await track.restartTrack(this.captureOptions(null));
      if (this.micMuted()) await track.mute();
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
      // Kurulum sürerken test başladı/bittiyse güncel duruma getir
      processor.setSendMuted(this.micTest !== null || this.resumeSendTimer !== null);
      processor.updateGate(this.gateConfig());
      if (this.micMuted() !== track.isMuted) this.applyMicMute();
      this.micTest?.liveChanged();
      // DPDFNet kurulamadıysa (ör. işlemci yetmedi) şimdilik standart engellemeyle yayınlanır; DeepFilterNet
      // ile yeniden denenir.
      if (processor.denoiserFailed && denoiser === 'dpdfnet') void this.republishMic();
    } catch (err) {
      track?.stop();
      this.micFailed = true;
      this.micTest?.liveChanged();
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
    this.micTest?.liveChanged();
    if (old) {
      await room.localParticipant.unpublishTrack(old, true).catch(() => undefined);
      old.stop();
    }
    await oldProcessor?.destroy().catch(() => undefined);
    await this.publishMic(room);
  }

  private onMicLevel(level: MicLevel): void {
    const s = getSettings();
    const speaking = level.open && !s.selfMute && !s.selfDeaf && !this.micTest && this.mic !== null;
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
    if (!useVoice.getState().micAllowed && useVoice.getState().status !== 'idle') {
      setVoice({ error: this.micBlockedReason() });
      return;
    }
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
    // Bas-konuş sesi (Ayarlar'dan açılır; varsayılan kapalı). Susturulmuşken tuş bir şey açmaz, ses de yok.
    const s = getSettings();
    if (useVoice.getState().status === 'connected' && s.inputMode === 'ptt' && !s.selfMute && !s.selfDeaf) {
      playSound(active ? 'pttOn' : 'pttOff');
    }
  }

  /**
   * LiveKit düzeyinde susturulmalı mı. Test sürerken mikrofon LiveKit'te açık kalır (kapatılırsa zincire ses
   * gelmez, kendini duyamazsın); odaya gitmeyi işlemcinin gönderim kazancı keser.
   */
  private micMuted(): boolean {
    const s = getSettings();
    return (s.selfMute || s.selfDeaf) && !this.micTest;
  }

  private applyMicMute(): void {
    if (!this.mic) return;
    if (this.micMuted()) void this.mic.mute();
    else void this.mic.unmute();
  }

  private applyVolumes(): void {
    const room = this.room;
    if (!room) return;
    const s = getSettings();
    const selfId = useSession.getState().user?.id;
    const deaf = s.selfDeaf || (selfId !== undefined && useGuild.getState().voiceStates[selfId]?.serverDeaf === true);
    for (const p of room.remoteParticipants.values()) {
      const silenced = deaf || s.localMutes[p.identity] === true;
      p.setVolume(silenced ? 0 : (s.userVolumes[p.identity] ?? 1), Track.Source.Microphone);
      p.setVolume(deaf ? 0 : (s.streamVolumes[p.identity] ?? 1), Track.Source.ScreenShareAudio);
    }
  }

  private syncVoiceState(): void {
    const s = getSettings();
    // Mikrofon testi sürerken diğerleri seni susturulmuş görür (kayıtlı susturma ayarın değişmez)
    const selfMute = s.selfMute || this.micTest !== null;
    gateway.send({ t: 'VOICE_STATE_SET', d: { selfMute, selfDeaf: s.selfDeaf } });
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
    if (next.noiseStrengthDb !== prev.noiseStrengthDb) this.processor?.setAttenLimit(next.noiseStrengthDb);
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
      .on(RoomEvent.TrackPublished, (pub, p) => {
        if (room === this.room) this.onPublication(pub, p, true);
      })
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
          this.refreshStream(p);
        }
        if (pub.source === Track.Source.ScreenShare && room === this.room) this.channelSounds.push('userStreamStop');
      })
      .on(RoomEvent.TrackSubscribed, (track, _pub, _p) => this.onSubscribed(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        this.bumpTracks();
      })
      .on(RoomEvent.ParticipantConnected, () => {
        this.applyVolumes();
        if (room === this.room) this.channelSounds.push('userJoin');
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.remoteSpeaking.delete(p.identity);
        this.publishSpeaking();
        this.refreshStream(p);
        if (room === this.room) this.channelSounds.push('userLeave');
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.remoteSpeaking = new Set(speakers.filter((sp) => !sp.isLocal).map((sp) => sp.identity));
        this.publishSpeaking();
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality, p) => {
        if (p.isLocal) setVoice({ quality });
      })
      .on(RoomEvent.Reconnecting, () => {
        this.duplicates.noteReconnect();
        if (room !== this.room) return;
        setVoice({ status: 'reconnecting' });
        // Kısa kopmalar sessiz geçer; bağlantı birkaç saniyede gelmezse "koptu" sesi
        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (room !== this.room || useVoice.getState().status !== 'reconnecting') return;
          this.lostSoundPlayed = true;
          playSound('disconnect');
        }, RECONNECT_SOUND_DELAY_MS);
      })
      .on(RoomEvent.SignalReconnecting, () => this.duplicates.noteReconnect())
      .on(RoomEvent.Reconnected, () => {
        this.duplicates.noteReconnect();
        if (room !== this.room) return;
        setVoice({ status: 'connected' });
        // Yeniden bağlanınca LiveKit katılımcıları yeniden bildirebilir: ses seli olmasın
        this.channelSounds.quiet();
        const wasLost = this.lostSoundPlayed;
        this.clearReconnectTimer();
        if (wasLost) playSound('reconnected');
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined);
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
        if (p.isLocal && room === this.room) void this.onPermissionsChanged(room);
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== this.room) return; // kendi başlattığımız ayrılma
        const channelId = useVoice.getState().channelId;
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          reportClientError(new Error(`ses bağlantısı kapandı: ${DisconnectReason[reason ?? 0] ?? reason}`), 'ses');
        }
        // Kendi yeniden bağlanmamızın ardından gelen "başka cihaz" uyarısı: sessizce kanala geri dön
        if (channelId && this.duplicates.shouldRejoin(reason === DisconnectReason.DUPLICATE_IDENTITY)) {
          void this.leave({ silent: true })
            .then(() => this.join(channelId, { silent: true }))
            .catch(() => undefined);
          return;
        }
        this.joinSeq++;
        void this.teardownRoom();
        setVoice({ ...RESET_ROOM_STATE, channelId: null, status: 'idle', error: disconnectMessage(reason) });
        // Kendin ayrılmadın (bağlantı koptu, çıkarıldın, başka cihazdan girildi): "koptu" sesi
        playSound(reason === DisconnectReason.CLIENT_INITIATED ? 'leave' : 'disconnect');
      });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.lostSoundPlayed = false;
  }

  private onPublication(pub: RemoteTrackPublication, p: RemoteParticipant, published = false): void {
    if (pub.source === Track.Source.Microphone) {
      pub.setSubscribed(true);
      return;
    }
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
      this.refreshStream(p);
      if (useVoice.getState().watching[p.identity]) pub.setSubscribed(true);
      // Kanaldaki biri yayına başladı (katılırken zaten süren yayınlar için ses yok)
      if (published && pub.source === Track.Source.ScreenShare) this.channelSounds.push('userStreamStart');
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

    // Ekran kartı kodlayıcısı: SDP anlaşmasından önce ayarlanmalı (bkz. hardwareEncoder.ts)
    const hardware = await prepareHardwareEncoder(videoTrack, opts.codec, preset);
    if (room !== this.room) {
      releaseHardwareEncoder(videoTrack);
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    const video = new LocalVideoTrack(videoTrack, undefined, true);
    await room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      videoCodec: opts.codec,
      // Donanım kodlayıcısı yayın ortasında hata verirse WebRTC başka kodeğe geçer; LiveKit sunucusu yük türü
      // değişince yayını izleyicilere iletmeyi keser. Yedek VP8 tanımlıyken sunucu izleyicileri kesintisiz ona
      // aktarır (yedek yalnızca gerektiğinde kodlanır, normalde ek yük yok).
      backupCodec: hardware ? { codec: 'vp8' } : false,
      // Simulcast kapalı: ekran kartı kodlayıcısı olmayan sistemlerde H.264 yazılımla (OpenH264) kodlanıyor;
      // 720p alt katman toplam kodlama süresini ~2 katına çıkarıp çözünürlüğü CPU yüzünden düşürtüyor.
      // 10–20 kişide sunucu trafiği kazancı bu bedele değmiyor.
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

    this.screen = { video, audio, preview: new StreamPreviewUploader(videoTrack, sourceOf(opts, videoTrack)) };
    this.screenHardwareEncoder = hardware;
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
    screen.preview.stop();
    this.screenHardwareEncoder = null;
    releaseHardwareEncoder(screen.video.mediaStreamTrack);
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

  /**
   * Ping ve giden paket kaybı her 2 saniyede yayın bağlantısından ölçülür (grafik ve kalite rengi için).
   * Bağlantı paneli açıkken iki bağlantının ayrıntılı istatistikleri de toplanır.
   */
  private async collectStats(): Promise<void> {
    const room = this.room;
    if (!room || this.statsBusy) return;
    this.statsBusy = true;
    try {
      const pcs = room.engine.pcManager;
      const detail = this.detailWatchers > 0;
      const at = Date.now();
      const pubReport = await pcs?.publisher.getStats()?.catch(() => undefined);
      const publisher = pubReport ? parseTransportStats(pubReport, at) : null;
      // Yayın bağlantısında ölçüm yoksa (ör. konuşma izni yok) ping abonelik bağlantısından alınır
      const needSubscriber = detail || publisher?.rttMs == null;
      const subReport = needSubscriber ? await pcs?.subscriber?.getStats()?.catch(() => undefined) : undefined;
      const subscriber = subReport ? parseTransportStats(subReport, at) : null;
      if (room !== this.room) return;

      const prev = this.statsPrev;
      this.statsPrev = { publisher, subscriber };
      const rttMs = publisher?.rttMs ?? subscriber?.rttMs ?? null;
      const { sent, lost } = outboundDelta(publisher, prev.publisher);
      const samples = pushSample(useConnectionStats.getState().samples, { at, rttMs, sent, lost });
      const recent = summarizePings(samples, at - QUALITY_WINDOW_MS);
      setConnectionStats({
        samples,
        quality: linkQuality(recent.lastMs, recent.lossPercent),
        detail: detail
          ? {
              at,
              publisher: publisher && describeTransport(publisher, prev.publisher),
              subscriber: subscriber && describeTransport(subscriber, prev.subscriber),
              labels: this.streamLabels(room),
            }
          : null,
      });
      if (rttMs !== null) setVoice({ pingMs: rttMs });
    } finally {
      this.statsBusy = false;
    }
  }

  /** Bağlantı paneli açıkken çağrılır; dönen işlev paneli kapatınca ayrıntılı ölçümü durdurur. */
  watchConnectionDetail(): () => void {
    this.detailWatchers++;
    void this.collectStats();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.detailWatchers = Math.max(0, this.detailWatchers - 1);
      if (this.detailWatchers === 0) setConnectionStats({ detail: null });
    };
  }

  private serverInfo(room: Room, url: string): VoiceServerInfo {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // adres çözümlenemezse olduğu gibi gösterilir
    }
    const info = room.serverInfo;
    return {
      host,
      roomName: room.name,
      region: info?.region || null,
      nodeId: info?.nodeId || null,
      version: info?.version || null,
      e2ee: room.isE2EEEnabled,
    };
  }

  /** getStats'taki track kimliklerini kullanıcı/kaynak adına çevirir */
  private streamLabels(room: Room): Record<string, StreamLabel> {
    const labels: Record<string, StreamLabel> = {};
    const add = (id: string | undefined, label: string, screen: boolean): void => {
      if (id) labels[id] = { label, screen };
    };
    const local = (track: LocalAudioTrack | LocalVideoTrack | null | undefined, label: string, screen: boolean): void => {
      if (!track) return;
      add(track.mediaStreamTrack?.id, label, screen);
      add(track.sender?.track?.id ?? undefined, label, screen);
    };
    local(this.mic, 'Mikrofonun', false);
    local(this.screen?.video, 'Ekran yayının', true);
    local(this.screen?.audio, 'Yayın sesin', true);
    const users = useGuild.getState().users;
    for (const p of room.remoteParticipants.values()) {
      const name = users[p.identity]?.displayName ?? (p.name || p.identity);
      for (const pub of p.trackPublications.values()) {
        const screen = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
        const what =
          pub.source === Track.Source.Microphone
            ? 'mikrofon'
            : pub.source === Track.Source.ScreenShare
              ? 'ekran yayını'
              : pub.source === Track.Source.ScreenShareAudio
                ? 'yayın sesi'
                : pub.kind;
        add(pub.track?.mediaStreamTrack?.id, `${name} · ${what}`, screen);
      }
    }
    return labels;
  }

  // ---------- Mikrofon testi (ayarlar ekranı) ----------

  /**
   * Ayarlardaki mikrofon testi (bkz. MicTest). Görüşmedeyken canlı zincirin dinleme kolu çalınır; test
   * sürdükçe odaya sessizlik gider ve diğerleri seni susturulmuş görür. Test durunca (durdur, ayarlar kapandı,
   * kanaldan çıkıldı) önceki durum aynen geri gelir: kayıtlı susturma/sağırlaştırma ayarı hiç değişmez,
   * sunucuda susturma da testten etkilenmez. Aynı anda tek test olur; yenisi eskisini durdurur.
   */
  startMicTest(onError: (message: string | null) => void): MicTest {
    this.micTest?.stop();
    const test: MicTest = new MicTest(
      {
        wantedDenoiser: () => this.wantedDenoiser(),
        captureOptions: (denoiser) => this.captureOptions(denoiser),
        gateConfig: () => this.gateConfig(),
        liveTrack: () => this.liveMicTrack(),
        onStop: () => {
          if (this.micTest !== test) return;
          this.micTest = null;
          this.applyMicTestState();
        },
      },
      onError,
    );
    this.micTest = test;
    this.applyMicTestState();
    // Kurucu, micTest atanmadan kaynağı seçmiş olabilir; canlı zincir varsa ona geçsin
    test.liveChanged();
    return test;
  }

  /** Görüşmedeki mikrofonun dinleme kolu; mikrofon kuruluyorsa 'pending', görüşmede yayın yoksa null */
  private liveMicTrack(): MediaStreamTrack | 'pending' | null {
    const track = this.processor?.monitorTrack;
    if (track) return track;
    const v = useVoice.getState();
    // Bağlanırken ya da mikrofon yeniden yayınlanırken (aygıt/gürültü ayarı değişti) ikinci bir mikrofon açılmaz
    return v.status === 'idle' || !v.micAllowed || this.micFailed ? null : 'pending';
  }

  /** Test başladı/bitti: odaya gönderimi, LiveKit susturmasını, bas-konuş kapısını ve görünen durumu uygula. */
  private applyMicTestState(): void {
    const testing = this.micTest !== null;
    setVoice({ micTesting: testing });
    if (this.resumeSendTimer !== null) window.clearTimeout(this.resumeSendTimer);
    this.resumeSendTimer = null;
    if (testing) {
      // Önce odaya gönderim kesilir, sonra (susturulduysan) mikrofon LiveKit'te açılır: hiçbir şey sızmaz
      this.processor?.setSendMuted(true);
      this.applyMicMute();
      this.processor?.updateGate(this.gateConfig());
      if (this.selfSpeaking) {
        this.selfSpeaking = false;
        this.publishSpeaking();
      }
    } else {
      // Önce susturma ve kapı geri gelir; zincirde kalan test sesi boşalınca gönderim açılır
      this.applyMicMute();
      this.processor?.updateGate(this.gateConfig());
      this.resumeSendTimer = window.setTimeout(() => {
        this.resumeSendTimer = null;
        if (!this.micTest) this.processor?.setSendMuted(false);
      }, MIC_TEST_RESUME_SEND_MS);
    }
    if (useVoice.getState().status !== 'idle') this.syncVoiceState();
  }
}

// LiveKit'in uyarıları sunucu kayıtlarına: kullanıcılardaki bağlantı sorunlarının nedenini görmek için
setLogExtension((level, message, context) => reportVoiceLog(level, LogLevel.warn, message, context));

export const voice = new VoiceClient();
