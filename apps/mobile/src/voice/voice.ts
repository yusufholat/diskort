import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import {
  api,
  errorMessage,
  gateway,
  reportClientError,
  reportVoiceLog,
  SpuriousDuplicateGuard,
  useGuild,
  useSession,
} from '@diskort/client-core';
import {
  ConnectionState,
  DisconnectReason,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
  LogLevel,
  Room,
  RoomEvent,
  setLogExtension,
  Track,
} from 'livekit-client';
import { Dimensions, PermissionsAndroid, PixelRatio, Platform } from 'react-native';
import { create } from 'zustand';
import { VoiceService } from '../../modules/voice-service';
import { getSettings, useSettings } from '../stores/settings';
import { toast } from '../stores/ui';

function disconnectMessage(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'Bu hesapla başka bir cihazdan ses kanalına bağlanıldı.';
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'Ses kanalından çıkarıldın.';
    case DisconnectReason.ROOM_DELETED:
      return 'Ses kanalı kapatıldı.';
    default:
      return 'Ses bağlantısı koptu.';
  }
}

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

/** Telefon ekranı paylaşılırken gönderilen görüntünün kısa kenarı (piksel) */
const SCREEN_SHARE_SHORT_SIDE = 720;

export interface ScreenShareStats {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  /** Kodlayıcı (ör. donanım: c2.qti.avc.encoder, yazılım: libvpx) */
  encoder: string | null;
  /** Kaliteyi düşüren neden: cpu (işlemci yetişmiyor) / bandwidth (bağlantı) */
  limit: string | null;
  /** İzleyicilerin istediği anahtar kare sayısı (çoksa görüntü kayboluyor demektir) */
  keyframeRequests: number;
}

interface VoiceStore {
  channelId: string | null;
  status: VoiceStatus;
  /** Konuşan kullanıcılar */
  speaking: Record<string, true>;
  /** Kanalda yayın yapan kullanıcılar */
  streams: Record<string, true>;
  /** İzlenen yayın (tek seferde bir tane; telefonda ekran küçük) */
  watching: string | null;
  /** Mikrofon izni yoksa yalnızca dinlenir */
  listenOnly: boolean;
  /** Kanalda konuşma izni var mı (yetki ya da sunucuda susturma; LiveKit izninden gelir) */
  micAllowed: boolean;
  /** Telefonun ekranı paylaşılıyor */
  sharing: boolean;
  /** Abonelikler değişince artar (video bileşenlerini tazelemek için) */
  tracksVersion: number;
}

const IDLE: Omit<VoiceStore, 'channelId' | 'status'> = {
  speaking: {},
  streams: {},
  watching: null,
  listenOnly: false,
  micAllowed: true,
  sharing: false,
  tracksVersion: 0,
};

export const useVoice = create<VoiceStore>()(() => ({ channelId: null, status: 'idle', ...IDLE }));

/** LiveKit protokolündeki kaynak numaraları (ParticipantPermission.canPublishSources) */
const PROTO_SOURCE = { microphone: 2, screenShare: 3 } as const;

/** LiveKit bu kaynağı yayınlamaya izin veriyor mu (sunucu izni kanaldaki yetkilere göre verir) */
function canPublish(room: Room, source: number): boolean {
  const p = room.localParticipant.permissions;
  if (!p) return true;
  return p.canPublish && (p.canPublishSources.length === 0 || p.canPublishSources.includes(source as never));
}

/** Kendi ses durumu (sunucuda susturma/sağırlaştırma buradan okunur) */
function selfVoiceState() {
  const selfId = useSession.getState().user?.id;
  return selfId ? useGuild.getState().voiceStates[selfId] : undefined;
}

const isAudio = (pub: RemoteTrackPublication): boolean =>
  pub.source === Track.Source.Microphone ||
  (pub.kind === Track.Kind.Audio && pub.source !== Track.Source.ScreenShareAudio);

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Number(Platform.Version) >= 31) wanted.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  // Android 13+: kalıcı "sesli sohbette" bildirimi için
  if (Number(Platform.Version) >= 33) wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Telefondaki sesli sohbet. Masaüstünden farklı olarak ses işleme (yankı/gürültü engelleme)
 * telefonun kendi donanımıyla yapılır; uygulama arka plandayken ön plan servisi bağlantıyı tutar.
 */
class MobileVoiceClient {
  private room: Room | null = null;
  private joinSeq = 0;
  private readonly duplicates = new SpuriousDuplicateGuard();

  constructor() {
    // Bildirimdeki düğmeler
    VoiceService.addListener('onAction', ({ action }) => {
      if (action === 'toggleMute') this.toggleMute();
      else void this.leave();
    });
    // Sunucuya yeniden bağlanınca ses durumunu tekrar bildir
    gateway.on((msg) => {
      if (msg.t === 'READY') this.syncVoiceState();
      // Yetkili biri seni başka ses kanalına taşıdı: o kanala geç
      if (msg.t === 'VOICE_MOVE' && useVoice.getState().channelId) {
        this.join(msg.d.channelId).catch((err: Error) => toast(err.message, 'error'));
      }
    });
    // Sunucuda sağırlaştırılınca kimse duyulmaz (dinleme LiveKit'te kesilmez, uygulama uygular)
    useGuild.subscribe((next, prev) => {
      const selfId = useSession.getState().user?.id;
      if (selfId && next.voiceStates[selfId]?.serverDeaf !== prev.voiceStates[selfId]?.serverDeaf) {
        void this.applyLocalState();
      }
    });
  }

  /** Mikrofon açılamıyorsa kullanıcıya gösterilecek neden */
  micBlockedReason(): string {
    const state = selfVoiceState();
    return state?.serverMute || state?.serverDeaf
      ? 'Sunucuda susturuldun; mikrofonunu yalnızca yetkili biri açabilir.'
      : 'Bu kanalda konuşma iznin yok.';
  }

  async join(channelId: string): Promise<void> {
    const current = useVoice.getState();
    if (current.channelId === channelId && current.status !== 'idle') return;
    const seq = ++this.joinSeq;
    await this.teardown();
    useVoice.setState({ ...IDLE, channelId, status: 'connecting' });

    try {
      const micGranted = await requestPermissions();
      const { url, token } = await api.joinVoice(channelId);
      if (seq !== this.joinSeq) return;

      await AudioSession.configureAudio({
        android: {
          preferredOutputList: getSettings().speaker
            ? ['bluetooth', 'headset', 'speaker']
            : ['bluetooth', 'headset', 'earpiece'],
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
      });
      await AudioSession.startAudioSession();

      const room = new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        publishDefaults: { dtx: true, red: true },
      });
      this.room = room;
      this.bind(room);
      await room.connect(url, token, { autoSubscribe: false });
      if (seq !== this.joinSeq) {
        await room.disconnect();
        return;
      }

      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) this.onPublication(pub, p);
      }
      useVoice.setState({
        status: 'connected',
        listenOnly: !micGranted,
        micAllowed: canPublish(room, PROTO_SOURCE.microphone),
      });
      // Konuşma izni yoksa (ya da sunucuda susturulduysa) yalnızca dinlenir; izin gelince açılır
      if (micGranted && !this.micMuted()) await room.localParticipant.setMicrophoneEnabled(true);

      const name = useGuild.getState().channels.find((c) => c.id === channelId)?.name ?? 'Ses kanalı';
      try {
        VoiceService.start(name, this.notificationText(), this.micMuted());
      } catch {
        // Servis başlatılamazsa ses yine çalışır; yalnızca arka planda kesilebilir
      }
      this.syncVoiceState();
    } catch (err) {
      if (seq !== this.joinSeq) return;
      await this.teardown();
      useVoice.setState({ ...IDLE, channelId: null, status: 'idle' });
      throw new Error(
        /pc connection|signal|websocket|fetch|could not establish/i.test(errorMessage(err))
          ? 'Ses sunucusuna bağlanılamadı. İnternet bağlantını kontrol et.'
          : errorMessage(err),
      );
    }
  }

  async leave(): Promise<void> {
    this.joinSeq++;
    await this.teardown();
    useVoice.setState({ ...IDLE, channelId: null, status: 'idle' });
  }

  toggleMute(): void {
    const s = getSettings();
    if (!useVoice.getState().micAllowed && useVoice.getState().status !== 'idle') {
      toast(this.micBlockedReason(), 'error');
      return;
    }
    // Sağırken susturmayı kaldırmak sağırlığı da kaldırır (Discord davranışı)
    if (s.selfDeaf) s.set({ selfDeaf: false, selfMute: false });
    else s.set({ selfMute: !s.selfMute });
    void this.applyLocalState();
  }

  toggleDeafen(): void {
    const s = getSettings();
    s.set({ selfDeaf: !s.selfDeaf });
    void this.applyLocalState();
  }

  async setSpeaker(on: boolean): Promise<void> {
    getSettings().set({ speaker: on });
    if (!this.room) return;
    try {
      const outputs = await AudioSession.getAudioOutputs();
      // Kulaklık/Bluetooth bağlıysa onu bozma
      if (outputs.includes('bluetooth') || outputs.includes('headset')) return;
      await AudioSession.selectAudioOutput(on ? 'speaker' : 'earpiece');
    } catch {
      // desteklenmiyorsa varsayılan çıkış kalır
    }
  }

  watch(userId: string | null): void {
    const room = this.room;
    if (!room) return;
    const previous = useVoice.getState().watching;
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.source !== Track.Source.ScreenShare && pub.source !== Track.Source.ScreenShareAudio) continue;
        if (p.identity === userId) pub.setSubscribed(true);
        else if (p.identity === previous) pub.setSubscribed(false);
      }
    }
    useVoice.setState({ watching: userId });
  }

  /**
   * Telefonun ekranını paylaşır / durdurur. Android her seferinde "ekranın kaydedilecek" onayı ister;
   * paylaşım bildirimden ya da sistemden durdurulursa durum kendiliğinden güncellenir.
   */
  async toggleScreenShare(): Promise<void> {
    const room = this.room;
    if (!room || useVoice.getState().status !== 'connected') return;
    const next = !useVoice.getState().sharing;
    this.lastShareSample = null;
    try {
      await room.localParticipant.setScreenShareEnabled(
        next,
        { audio: false },
        {
          // VP8: yazılım kodlayıcısı her telefonda var. H.264 telefonun donanım kodlayıcısına kalıyor; bazı
          // telefonlarda (ör. 0.2.2'de denenen) bu boyuttaki dikey görüntüde hiç kare üretmiyor ve yayın ölü kalıyor.
          videoCodec: 'vp8',
          simulcast: false,
          screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 24 },
          // Sıkışınca kare atlamak (donma) yerine netliği düşür
          degradationPreference: 'maintain-framerate',
        },
      );
      if (next) await this.scaleScreenShare(room);
      useVoice.setState({ sharing: next && Boolean(room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) });
    } catch (err) {
      useVoice.setState({ sharing: false });
      const message = errorMessage(err);
      // Kullanıcı Android'in onay penceresinde vazgeçtiyse hata gösterme
      if (!/permission|denied|cancel|NotAllowed/i.test(message)) toast(`Ekran paylaşılamadı: ${message}`, 'error');
    }
  }

  /**
   * Android ekranı her zaman tam çözünürlükte yakalar (ör. 1220×2656). Gönderilen görüntü kısa kenarı
   * ~720 piksel olacak şekilde küçültülür; aksi hâlde kodlayıcı yetişemez ve yayın donar.
   */
  private async scaleScreenShare(room: Room): Promise<void> {
    const sender = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack?.sender;
    if (!sender) return;
    const { width, height } = Dimensions.get('screen');
    const shortSide = Math.min(width, height) * PixelRatio.get();
    const scale = Math.max(1, shortSide / SCREEN_SHARE_SHORT_SIDE);
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      for (const encoding of params.encodings ?? []) encoding.scaleResolutionDownBy = scale;
      params.degradationPreference = 'maintain-framerate';
      await sender.setParameters(params);
    } catch {
      // desteklenmiyorsa tam çözünürlükte devam eder
    }
  }

  private lastShareSample: { bytes: number; at: number } | null = null;

  /** Paylaşılan ekranın gönderim bilgileri: donma gibi sorunların nedenini görmek için ses ekranında gösterilir. */
  async screenShareStats(): Promise<ScreenShareStats | null> {
    const sender = this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack?.sender;
    if (!sender) return null;
    let found: Record<string, unknown> | null = null;
    (await sender.getStats()).forEach((entry: Record<string, unknown>) => {
      if (entry.type === 'outbound-rtp' && entry.kind === 'video') found = entry;
    });
    const stats = found as Record<string, unknown> | null;
    if (!stats) return null;
    const num = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
    const bytes = num('bytesSent');
    const at = Date.now();
    const previous = this.lastShareSample;
    this.lastShareSample = { bytes, at };
    const reason = typeof stats.qualityLimitationReason === 'string' ? stats.qualityLimitationReason : 'none';
    return {
      width: num('frameWidth'),
      height: num('frameHeight'),
      fps: Math.round(num('framesPerSecond')),
      kbps: previous && at > previous.at ? Math.round(((bytes - previous.bytes) * 8) / (at - previous.at)) : 0,
      encoder: typeof stats.encoderImplementation === 'string' ? stats.encoderImplementation : null,
      limit: reason === 'none' ? null : reason,
      keyframeRequests: num('pliCount') + num('firCount'),
    };
  }

  getScreenPublication(userId: string): { participant: RemoteParticipant; publication: RemoteTrackPublication } | null {
    const participant = this.room?.remoteParticipants.get(userId);
    const publication = participant?.getTrackPublication(Track.Source.ScreenShare);
    return participant && publication ? { participant, publication } : null;
  }

  private micMuted(): boolean {
    const s = getSettings();
    const v = useVoice.getState();
    return s.selfMute || s.selfDeaf || v.listenOnly || !v.micAllowed;
  }

  /** Kendi ya da sunucu sağırlaştırması */
  private deafened(): boolean {
    return getSettings().selfDeaf || selfVoiceState()?.serverDeaf === true;
  }

  private notificationText(): string {
    const s = getSettings();
    if (s.selfDeaf) return 'Sağırlaştırıldın';
    if (selfVoiceState()?.serverDeaf) return 'Sunucuda sağırlaştırıldın';
    if (!useVoice.getState().micAllowed) return selfVoiceState()?.serverMute ? 'Sunucuda susturuldun' : 'Yalnızca dinliyorsun';
    if (s.selfMute) return 'Susturuldun';
    return 'Sesli sohbete bağlı';
  }

  private async applyLocalState(): Promise<void> {
    const room = this.room;
    this.syncVoiceState();
    if (!room) return;
    const deaf = this.deafened();
    // Sağırken diğerlerinin sesi hiç indirilmez (hem sessizlik hem veri tasarrufu)
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) if (isAudio(pub)) pub.setSubscribed(!deaf);
    }
    if (!useVoice.getState().listenOnly) await room.localParticipant.setMicrophoneEnabled(!this.micMuted()).catch(() => undefined);
    const name = useGuild.getState().channels.find((c) => c.id === useVoice.getState().channelId)?.name ?? 'Ses kanalı';
    VoiceService.update(name, this.notificationText(), this.micMuted());
  }

  private syncVoiceState(): void {
    if (useVoice.getState().status === 'idle') return;
    const s = getSettings();
    gateway.send({ t: 'VOICE_STATE_SET', d: { selfMute: s.selfMute || useVoice.getState().listenOnly, selfDeaf: s.selfDeaf } });
  }

  private onPublication(pub: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (isAudio(pub)) {
      pub.setSubscribed(!this.deafened());
    } else if (pub.source === Track.Source.ScreenShare) {
      useVoice.setState((s) => ({ streams: { ...s.streams, [participant.identity]: true } }));
      if (useVoice.getState().watching === participant.identity) pub.setSubscribed(true);
    } else if (pub.source === Track.Source.ScreenShareAudio) {
      if (useVoice.getState().watching === participant.identity) pub.setSubscribed(true);
    }
  }

  private bind(room: Room): void {
    const bump = (): void => useVoice.setState((s) => ({ tracksVersion: s.tracksVersion + 1 }));
    room
      .on(RoomEvent.TrackPublished, (pub, p) => this.onPublication(pub, p))
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source !== Track.Source.ScreenShare) return;
        useVoice.setState((s) => {
          const { [p.identity]: _gone, ...streams } = s.streams;
          return { streams, watching: s.watching === p.identity ? null : s.watching };
        });
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) useVoice.setState({ sharing: false });
      })
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        useVoice.setState((s) => {
          const { [p.identity]: _gone, ...streams } = s.streams;
          return { streams, watching: s.watching === p.identity ? null : s.watching };
        });
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        useVoice.setState({ speaking: Object.fromEntries(speakers.map((p) => [p.identity, true as const])) });
      })
      // İzinler değişti (rol, kanal izni, sunucuda susturma): mikrofonu ve yayını ona göre aç/kapat
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (!participant.isLocal || this.room !== room) return;
        useVoice.setState({ micAllowed: canPublish(room, PROTO_SOURCE.microphone) });
        void this.applyLocalState();
        if (useVoice.getState().sharing && !canPublish(room, PROTO_SOURCE.screenShare)) void this.toggleScreenShare();
      })
      .on(RoomEvent.Reconnecting, () => {
        this.duplicates.noteReconnect();
        useVoice.setState({ status: 'reconnecting' });
      })
      .on(RoomEvent.SignalReconnecting, () => this.duplicates.noteReconnect())
      .on(RoomEvent.Reconnected, () => {
        this.duplicates.noteReconnect();
        useVoice.setState({ status: 'connected' });
        this.syncVoiceState();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        // Kendi başlattığımız ayrılma değilse: sunucu çıkardı, başka cihaza geçildi ya da bağlantı koptu
        if (this.room !== room || room.state !== ConnectionState.Disconnected) return;
        const channelId = useVoice.getState().channelId;
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          reportClientError(new Error(`ses bağlantısı kapandı: ${DisconnectReason[reason ?? 0] ?? reason}`), 'ses');
        }
        // Kendi yeniden bağlanmamızın ardından gelen "başka cihaz" uyarısı: sessizce kanala geri dön
        if (channelId && this.duplicates.shouldRejoin(reason === DisconnectReason.DUPLICATE_IDENTITY)) {
          void this.leave()
            .then(() => this.join(channelId))
            .catch((err: Error) => toast(err.message, 'error'));
          return;
        }
        toast(disconnectMessage(reason), reason === DisconnectReason.CLIENT_INITIATED ? 'info' : 'error');
        void this.leave();
      });
  }

  private async teardown(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) await room.disconnect(true).catch(() => undefined);
    await AudioSession.stopAudioSession().catch(() => undefined);
    try {
      VoiceService.stop();
    } catch {
      // servis zaten kapalı
    }
  }
}

// LiveKit'in uyarıları sunucu kayıtlarına: telefondaki bağlantı sorunlarının nedenini görmek için
setLogExtension((level, message, context) => reportVoiceLog(level, LogLevel.warn, message, context));

export const voice = new MobileVoiceClient();

// Ayarlar dışarıdan değişirse (ör. bildirim düğmesi) ekran güncel kalsın diye dışa aç
export { useSettings };
