import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { api, errorMessage, gateway, useGuild } from '@diskort/client-core';
import {
  ConnectionState,
  DisconnectReason,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
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
  sharing: false,
  tracksVersion: 0,
};

export const useVoice = create<VoiceStore>()(() => ({ channelId: null, status: 'idle', ...IDLE }));

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

  constructor() {
    // Bildirimdeki düğmeler
    VoiceService.addListener('onAction', ({ action }) => {
      if (action === 'toggleMute') this.toggleMute();
      else void this.leave();
    });
    // Sunucuya yeniden bağlanınca ses durumunu tekrar bildir
    gateway.on((msg) => {
      if (msg.t === 'READY') this.syncVoiceState();
    });
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
      useVoice.setState({ status: 'connected', listenOnly: !micGranted });
      if (micGranted) await room.localParticipant.setMicrophoneEnabled(!this.micMuted());

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
    try {
      await room.localParticipant.setScreenShareEnabled(
        next,
        { audio: false },
        {
          videoCodec: 'h264',
          simulcast: false,
          screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
        },
      );
      useVoice.setState({ sharing: next && Boolean(room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) });
    } catch (err) {
      useVoice.setState({ sharing: false });
      const message = errorMessage(err);
      // Kullanıcı Android'in onay penceresinde vazgeçtiyse hata gösterme
      if (!/permission|denied|cancel|NotAllowed/i.test(message)) toast(`Ekran paylaşılamadı: ${message}`, 'error');
    }
  }

  getScreenPublication(userId: string): { participant: RemoteParticipant; publication: RemoteTrackPublication } | null {
    const participant = this.room?.remoteParticipants.get(userId);
    const publication = participant?.getTrackPublication(Track.Source.ScreenShare);
    return participant && publication ? { participant, publication } : null;
  }

  private micMuted(): boolean {
    const s = getSettings();
    return s.selfMute || s.selfDeaf || useVoice.getState().listenOnly;
  }

  private notificationText(): string {
    const s = getSettings();
    if (s.selfDeaf) return 'Sağırlaştırıldın';
    if (s.selfMute) return 'Susturuldun';
    return 'Sesli sohbete bağlı';
  }

  private async applyLocalState(): Promise<void> {
    const room = this.room;
    this.syncVoiceState();
    if (!room) return;
    const deaf = getSettings().selfDeaf;
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
      pub.setSubscribed(!getSettings().selfDeaf);
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
      .on(RoomEvent.Reconnecting, () => useVoice.setState({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => {
        useVoice.setState({ status: 'connected' });
        this.syncVoiceState();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        // Kendi başlattığımız ayrılma değilse: sunucu çıkardı, başka cihaza geçildi ya da bağlantı koptu
        if (this.room !== room || room.state !== ConnectionState.Disconnected) return;
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

export const voice = new MobileVoiceClient();

// Ayarlar dışarıdan değişirse (ör. bildirim düğmesi) ekran güncel kalsın diye dışa aç
export { useSettings };
